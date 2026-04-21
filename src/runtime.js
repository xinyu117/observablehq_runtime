import {RuntimeError} from "./errors.js";
import {generatorish} from "./generatorish.js";
import {Module, variable_variable, variable_invalidation, variable_visibility} from "./module.js";
import {noop} from "./noop.js";
import {Variable, TYPE_IMPLICIT, no_observer, variable_stale} from "./variable.js";

// 将整轮重算推迟到“当前调用栈之后的下一次调度机会”。
// 这里优先使用 requestAnimationFrame；它严格来说不是宏任务，而是浏览器在下一次绘制前
// 触发的回调。若不可用，则退化为 setImmediate / setTimeout(0)，它们会把回调放到后续
// 的任务队列中。无论走哪条分支，目的都一致：不要在当前同步栈内立刻重算，而是把多次
// 脏标记合并到后面统一处理。
const frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame
  : typeof setImmediate === "function" ? setImmediate
  : f => setTimeout(f, 0);

export function Runtime(builtins, global = window_global) {
  const builtin = this.module();
  Object.defineProperties(this, {
    _dirty: {value: new Set},
    _updates: {value: new Set},
    _precomputes: {value: [], writable: true},
    _computing: {value: null, writable: true},
    _init: {value: null, writable: true},
    _modules: {value: new Map},
    _variables: {value: new Set},
    _disposed: {value: false, writable: true},
    _builtin: {value: builtin},
    _global: {value: global}
  });
  if (builtins) for (const name in builtins) {
    (new Variable(TYPE_IMPLICIT, builtin)).define(name, [], builtins[name]);
  }
}

Object.defineProperties(Runtime.prototype, {
  _precompute: {value: runtime_precompute, writable: true, configurable: true},
  _compute: {value: runtime_compute, writable: true, configurable: true},
  _computeSoon: {value: runtime_computeSoon, writable: true, configurable: true},
  _computeNow: {value: runtime_computeNow, writable: true, configurable: true},
  dispose: {value: runtime_dispose, writable: true, configurable: true},
  module: {value: runtime_module, writable: true, configurable: true}
});

function runtime_dispose() {
  this._computing = Promise.resolve();
  this._disposed = true;
  this._variables.forEach(v => {
    v._invalidate();
    v._version = NaN;
  });
}

function runtime_module(define, observer = noop) {
  let module;
  if (define === undefined) {
    if (module = this._init) {
      this._init = null;
      return module;
    }
    return new Module(this);
  }
  module = this._modules.get(define);
  if (module) return module;
  this._init = module = new Module(this);
  this._modules.set(define, module);
  try {
    define(this, observer);
  } finally {
    this._init = null;
  }
  return module;
}

function runtime_precompute(callback) {
  this._precomputes.push(callback);
  this._compute();
}

function runtime_compute() {
  // 同一轮里无论多少次调用 _compute，都只复用同一个 Promise，避免重复排队。
  return this._computing || (this._computing = this._computeSoon());
}

function runtime_computeSoon() {
  // 执行顺序分两层：
  // 1. new Promise(frame): 先等到 frame 回调触发，也就是离开当前同步栈，并跨过当前这批
  //    微任务；在浏览器里通常是下一帧前，在其他环境里通常是下一次任务。
  // 2. .then(...): 当上面的 Promise 被 resolve 后，再在“那一轮”的微任务阶段进入
  //    _computeNow。这样既不会同步重入，也能在真正开始拓扑计算前继续利用 Promise 链。
  return new Promise(frame).then(() => this._disposed ? undefined : this._computeNow());
}

/*
原始 async 写法
async function foo() {
  const a = await bar();
  return a + 1;
}
等价 Promise 写法:
function foo() {
  return Promise.resolve(bar()).then(a => {
    return a + 1;
  });
}
*/
// await x → Promise.resolve(x).then(...)
// async function → 一定返回 Promise
// 因此，postcompute(value, promise).then(() => runtime._precompute(recompute));的意思是：runtime._precompute(recompute)的执行是在，
// runtime_defer(3)之后的变量计算之后
async function runtime_computeNow() {
  let queue = [],
      variables,
      variable,
      precomputes = this._precomputes;

  // 如果有暂停中的 generator，先恢复它们，再继续做依赖图计算。
  // 这样做的目的，是让“同步 yield 的 generator”先把最新值写回当前变量，随后下游变量
  // 在同一轮重算时读到的就是新值，而不是上一轮的旧值。
  if (precomputes.length) {
    this._precomputes = [];
    for (const callback of precomputes) callback();

    // 这里特意再等待几层微任务，而不是开启新的宏任务。
    // 具体顺序可以理解为：
    // 1. callback() 内部会重新驱动 generator.next(...)。
    // 2. generator.next 的结果会通过 Promise.then 进入后续处理，因此即使 generator 是同步
    //    的，它的“产出值 -> 写回 variable._value -> 标记下游待更新”仍然发生在微任务里。
    // 3. await runtime_defer(3) 让当前 async 函数稍后再继续，从而把这条微任务链先跑完。
    // 最终效果是：不切到下一轮任务，但在本轮真正做拓扑重算前，先消化掉 generator 的同步产出。
    await runtime_defer(3);
  }

  // 计算脏变量传递闭包上的可达性：
  // 新变为可达的变量也需要参与本轮重算；
  // 不再可达的变量则需要终止（触发失效处理）。
  variables = new Set(this._dirty);
  variables.forEach(function(variable) {
    variable._inputs.forEach(variables.add, variables);
    const reachable = variable_reachable(variable);
    if (reachable > variable._reachable) {
      this._updates.add(variable);
    } else if (reachable < variable._reachable) {
      variable._invalidate();
    }
    variable._reachable = reachable;
  }, this);

  // 对“待更新且可达”的变量继续展开传递闭包。
  variables = new Set(this._updates);
  variables.forEach(function(variable) {
    if (variable._reachable) {
      variable._indegree = 0;
      variable._outputs.forEach(variables.add, variables);
    } else {
      variable._indegree = NaN;
      variables.delete(variable);
    }
  });

  this._computing = null;
  this._updates.clear();
  this._dirty.clear();

  // 计算待更新变量的入度（只统计同样处于更新集内的上游边）。
  variables.forEach(function(variable) {
    variable._outputs.forEach(variable_increment);
  });

  do {
    // 找出根变量（入度为 0，即没有待更新输入的变量）。
    variables.forEach(function(variable) {
      if (variable._indegree === 0) {
        queue.push(variable);
      }
    });

    // 按拓扑顺序执行变量计算。
    while (variable = queue.pop()) {
      variable_compute(variable);
      variable._outputs.forEach(postqueue);
      variables.delete(variable);
    }

    // 仍然残留的变量要么在环上，要么依赖环上的变量。
    variables.forEach(function(variable) {
      if (variable_circular(variable)) {
        variable_error(variable, new RuntimeError("circular definition"));
        variable._outputs.forEach(variable_decrement);
        variables.delete(variable);
      }
    });
  } while (variables.size);

  function postqueue(variable) {
    if (--variable._indegree === 0) {
      queue.push(variable);
    }
  }
}

// 构造一条指定深度的“纯微任务”Promise 链。
// 它不会像 setTimeout 那样切到下一轮任务，只是把当前 async 函数的继续执行顺延到后面的
// 若干个微任务之后。这里用于给同步 generator 留出时间，把它通过 Promise 链发布出来的
// 新值先写入变量，然后再计算下游依赖。
// depth = 3 不是事件循环的固定语义要求，而是为当前实现中的几段 Promise.then 链预留出
// 足够的先后顺序，避免下游过早开始读取旧值。
function runtime_defer(depth = 0) {
  let p = Promise.resolve();
  for (let i = 0; i < depth; ++i) p = p.then(() => {});
  return p;
}

function variable_circular(variable) {
  const inputs = new Set(variable._inputs);
  for (const i of inputs) {
    if (i === variable) return true;
    i._inputs.forEach(inputs.add, inputs);
  }
  return false;
}

function variable_increment(variable) {
  ++variable._indegree;
}

function variable_decrement(variable) {
  --variable._indegree;
}

function variable_value(variable) {
  return variable._promise.catch(variable._rejector);
}

function variable_invalidator(variable) {
  return new Promise(function(resolve) {
    variable._invalidate = resolve;
  });
}

function variable_intersector(invalidation, variable) {
  let node = typeof IntersectionObserver === "function" && variable._observer && variable._observer._node;
  let visible = !node, resolve = noop, reject = noop, promise, observer;
  if (node) {
    observer = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting) && (promise = null, resolve()));
    observer.observe(node);
    invalidation.then(() => (observer.disconnect(), observer = null, reject()));
  }
  return function(value) {
    if (visible) return Promise.resolve(value);
    if (!observer) return Promise.reject();
    if (!promise) promise = new Promise((y, n) => (resolve = y, reject = n));
    return promise.then(() => value);
  };
}

function variable_compute(variable) {
  variable._invalidate();
  variable._invalidate = noop;
  variable._pending();

  const value0 = variable._value;
  const version = ++variable._version;
  const inputs = variable._inputs;
  const definition = variable._definition;

  // 失效信号变量按需创建：只有当定义函数显式引用 invalidation 时才会构造。
  let invalidation = null;

  // 串行化同一个变量的求值流程：
  // 1. 先等上一次 _promise 完成，避免同一变量的多次定义并发写入。
  // 2. 再依次执行 init -> define -> generate，这三步都挂在 Promise 链上，因此即便输入、
  //    定义函数或 generator 是同步的，对外也保持统一的异步边界。
  const promise = variable._promise = variable._promise
    .then(init, init)
    .then(define)
    .then(generate);

  function init() {
    return Promise.all(inputs.map(variable_value));
  }

  // 计算变量本轮的初始值。
  function define(inputs) {
    if (variable._version !== version) throw variable_stale;

    // 按需把特殊占位输入替换为真正的运行时对象（invalidation / visibility / variable）。
    for (let i = 0, n = inputs.length; i < n; ++i) {
      switch (inputs[i]) {
        case variable_invalidation: {
          inputs[i] = invalidation = variable_invalidator(variable);
          break;
        }
        case variable_visibility: {
          if (!invalidation) invalidation = variable_invalidator(variable);
          inputs[i] = variable_intersector(invalidation, variable);
          break;
        }
        case variable_variable: {
          inputs[i] = variable;
          break;
        }
      }
    }

    return definition.apply(value0, inputs);
  }

  // 如果定义结果是 generator，则先拉取第一个值。
  // 这里有两个关键点：
  // 1. 第一个值仍然经由 Promise 链取得，因此不会在当前同步栈里直接把下游全部重算完。
  // 2. 一旦变量失效，就调用 generator.return()；如果失效发生得更早，这里也会立即终止它。
  function generate(value) {
    if (variable._version !== version) throw variable_stale;
    if (generatorish(value)) {
      (invalidation || variable_invalidator(variable)).then(variable_return(value));
      return variable_generate(variable, version, value);
    }
    return value;
  }

  promise.then((value) => {
    variable._value = value;
    variable._fulfilled(value);
  }, (error) => {
    if (error === variable_stale || variable._version !== version) return;
    variable._value = undefined;
    variable._rejected(error);
  });
}

function variable_generate(variable, version, generator) {
  const runtime = variable._module._runtime;
  let currentValue; // 让下一次 next(currentValue) 能拿到上一次 yield 的值

  // 统一用 Promise 包住 generator.next(...)。
  // 这样即便 generator.next 同步返回，后续的 done/value 分发也会落到微任务里执行，避免
  // 与当前重算过程形成同步重入。返回值要么是这次 yield 的值，要么是 generator 结束后的
  // undefined。
  function compute(onfulfilled) {
    return new Promise(resolve => resolve(generator.next(currentValue))).then(({done, value}) => {
      return done ? undefined : Promise.resolve(value).then(onfulfilled);
    });
  }

  // 拉取后续值时的顺序是：
  // 1. 先在微任务里拿到本次 yield 的值。
  // 2. 通过 postcompute 把当前变量值写回，并把下游变量加入待更新集合。
  // 3. 当前这轮 _compute 完成后，再通过 runtime._precompute(recompute) 把“下一次拉取”
  //    安排到下一个 frame 边界开始时执行，而不是在同一轮里把 generator 一口气跑到底。
  // 这使得 generator 的多次 yield 呈现为按帧/按任务推进，而每次 yield 产生的值又能先于
  // 下游重算在微任务里完成落盘。
  function recompute() {
    const promise = compute((value) => {
      if (variable._version !== version) throw variable_stale;
      currentValue = value;
      postcompute(value, promise).then(() => runtime._precompute(recompute));
      variable._fulfilled(value);
      return value;
    });
    promise.catch((error) => {
      if (error === variable_stale || variable._version !== version) return;
      postcompute(undefined, promise);
      variable._rejected(error);
    });
  }

  // 一次 yield/报错结束后，先更新当前变量的状态，再把受影响的下游变量标记为待更新，最后
  // 交给 runtime._compute 合并调度。这意味着“当前值写回”总是先于“下游重新读取”。
  function postcompute(value, promise) {
    variable._value = value;
    variable._promise = promise;
    variable._outputs.forEach(runtime._updates.add, runtime._updates);
    return runtime._compute();
  }

  // 第一个值的处理稍有不同：外层 variable_compute 已经建好了这次求值的 Promise 图，所以
  // 这里只需要拿到首个值并登记“下一次拉取”即可，不必额外触发一轮 postcompute。
  return compute((value) => {
    if (variable._version !== version) throw variable_stale;
    currentValue = value;
    runtime._precompute(recompute);
    return value;
  });
}

function variable_error(variable, error) {
  variable._invalidate();
  variable._invalidate = noop;
  variable._pending();
  ++variable._version;
  variable._indegree = NaN;
  (variable._promise = Promise.reject(error)).catch(noop);
  variable._value = undefined;
  variable._rejected(error);
}

function variable_return(generator) {
  return function() {
    generator.return();
  };
}

function variable_reachable(variable) {
  if (variable._observer !== no_observer) return true; // 直接可达（有观察者订阅）。
  const outputs = new Set(variable._outputs);
  for (const output of outputs) {
    if (output._observer !== no_observer) return true;
    output._outputs.forEach(outputs.add, outputs);
  }
  return false;
}

function window_global(name) {
  return globalThis[name];
}
