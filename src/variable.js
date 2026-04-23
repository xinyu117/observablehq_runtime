import {map} from "./array.js";
import {constant} from "./constant.js";
import {RuntimeError} from "./errors.js";
import {identity} from "./identity.js";
import {noop} from "./noop.js";

// Variable 代表运行时依赖图中的一个“节点”。
// 它既保存定义信息（inputs/definition），也保存执行态（promise/value/version）。
// 运行时通过 _inputs/_outputs 维护有向边，并用 _updates/_dirty 驱动增量重算。

export const TYPE_NORMAL = 1; // a normal variable
export const TYPE_IMPLICIT = 2; // created on reference
export const TYPE_DUPLICATE = 3; // created on duplicate definition

export const no_observer = Symbol("no-observer");
export const no_value = Promise.resolve();

export function Variable(type, module, observer, options) {
  if (!observer) observer = no_observer;
  Object.defineProperties(this, {
    _observer: {value: observer, writable: true},
    // 当前变量的定义函数；默认是“未定义占位函数”。
    _definition: {value: variable_undefined, writable: true},
    // 处理重名时的备用定义（冲突解除后可恢复）。
    _duplicate: {value: undefined, writable: true},
    // 若名字冲突到多个定义，使用集合记录全部候选定义。
    _duplicates: {value: undefined, writable: true},
    _indegree: {value: NaN, writable: true}, // The number of computing inputs.
    // 上游依赖列表（有序数组，位置对应 define 的输入参数顺序）。
    _inputs: {value: [], writable: true},
    // 失效钩子：每轮重算前会触发旧值失效（例如停止 generator、取消订阅等）。
    _invalidate: {value: noop, writable: true},
    _module: {value: module},
    // 变量名；匿名变量时为 null。
    _name: {value: null, writable: true},
    // 下游依赖集合。
    _outputs: {value: new Set, writable: true},
    // 当前这轮求值 Promise；用于串行化同一变量的多次重算。
    _promise: {value: no_value, writable: true},
    _reachable: {value: observer !== no_observer, writable: true}, // Is this variable transitively visible?
    // 统一错误包装器：把内部错误映射为带变量名的 RuntimeError。
    _rejector: {value: variable_rejector(this)},
    // 阴影作用域（可选）：优先于模块解析。
    _shadow: {value: initShadow(module, options)},
    _type: {value: type},
    // 最近一次成功计算出来的值。
    _value: {value: undefined, writable: true},
    // 版本号用于“防陈旧写入”：旧轮次完成后若版本不匹配则丢弃结果。
    _version: {value: 0, writable: true}
  });
}

Object.defineProperties(Variable.prototype, {
  _pending: {value: variable_pending, writable: true, configurable: true},
  _fulfilled: {value: variable_fulfilled, writable: true, configurable: true},
  _rejected: {value: variable_rejected, writable: true, configurable: true},
  _resolve: {value: variable_resolve, writable: true, configurable: true},
  define: {value: variable_define, writable: true, configurable: true},
  delete: {value: variable_delete, writable: true, configurable: true},
  import: {value: variable_import, writable: true, configurable: true}
});

function initShadow(module, options) {
  // shadow 用来覆盖同名依赖解析，常见于测试或局部注入。
  if (!options?.shadow) return null;
  return new Map(
    Object.entries(options.shadow)
      .map(([name, definition]) => [name, (new Variable(TYPE_IMPLICIT, module)).define([], definition)])
  );
}

function variable_attach(variable) {
  // 当前变量依赖了 variable：
  // 1) 需要把 variable 标脏（它的可达性/拓扑关系可能随边变化而变化）
  // 2) 建立 variable -> this 的输出边
  variable._module._runtime._dirty.add(variable);
  variable._outputs.add(this);
}

function variable_detach(variable) {
  // 解除依赖时同理，需要标脏并断开输出边。
  variable._module._runtime._dirty.add(variable);
  variable._outputs.delete(this);
}

function variable_undefined() {
  // 直接抛函数本身作为哨兵，后续在 rejector 中转为可读错误。
  throw variable_undefined;
}

export function variable_stale() {
  // 同样使用函数本身作为“陈旧结果”哨兵。
  throw variable_stale;
}

function variable_rejector(variable) {
  return (error) => {
    // 两个哨兵错误保留语义；其余错误统一包装为 RuntimeError。
    if (error === variable_stale) throw error;
    if (error === variable_undefined) throw new RuntimeError(`${variable._name} is not defined`, variable._name);
    if (error instanceof Error && error.message) throw new RuntimeError(error.message, variable._name);
    throw new RuntimeError(`${variable._name} could not be resolved`, variable._name);
  };
}

function variable_duplicate(name) {
  return () => {
    throw new RuntimeError(`${name} is defined more than once`);
  };
}

function variable_define(name, inputs, definition) {
  // 兼容三种 API 形态：
  // define(definition)
  // define(inputs, definition)
  // define(name, inputs|definition, definition?)
  switch (arguments.length) {
    case 1: {
      definition = name, name = inputs = null;
      break;
    }
    case 2: {
      definition = inputs;
      if (typeof name === "string") inputs = null;
      else inputs = name, name = null;
      break;
    }
  }
  return variable_defineImpl.call(this,
    name == null ? null : String(name),
    inputs == null ? [] : map.call(inputs, this._resolve, this),
    typeof definition === "function" ? definition : constant(definition)
  );
}

function variable_resolve(name) {
  // 名称解析优先 shadow，其次模块作用域。
  return this._shadow?.get(name) ?? this._module._resolve(name);
}

function variable_defineImpl(name, inputs, definition) {
  const scope = this._module._scope, runtime = this._module._runtime;

  // 重建依赖边：先拆旧边，再挂新边。
  this._inputs.forEach(variable_detach, this);
  inputs.forEach(variable_attach, this);
  this._inputs = inputs;
  this._definition = definition;
  this._value = undefined;

  // Is this an active variable (that may require disposal)?
  if (definition === noop) runtime._variables.delete(this);
  else runtime._variables.add(this);

  // Did the variable’s name change? Time to patch references!
  if (name !== this._name || scope.get(name) !== this) {
    let error, found;

    if (this._name) { // Did this variable previously have a name?
      if (this._outputs.size) { // And did other variables reference this variable?
        // 旧名字仍被引用：创建/复用一个隐式占位变量承接这些引用，
        // 当前变量则可以安全改名。
        scope.delete(this._name);
        found = this._module._resolve(this._name);
        found._outputs = this._outputs, this._outputs = new Set;
        found._outputs.forEach(function(output) { output._inputs[output._inputs.indexOf(this)] = found; }, this);
        found._outputs.forEach(runtime._updates.add, runtime._updates);
        runtime._dirty.add(found).add(this);
        scope.set(this._name, found);
      } else if ((found = scope.get(this._name)) === this) { // Do no other variables reference this variable?
        scope.delete(this._name); // It’s safe to delete!
      } else if (found._type === TYPE_DUPLICATE) { // Do other variables assign this name?
        // 该变量原来参与了“重名冲突集合”，现在退出该集合。
        found._duplicates.delete(this); // This variable no longer assigns this name.
        this._duplicate = undefined;
        if (found._duplicates.size === 1) { // Is there now only one variable assigning this name?
          // 冲突解除：仅剩一个真实定义，恢复它并把引用从 duplicate 节点切回去。
          found = found._duplicates.keys().next().value; // Any references are now fixed!
          error = scope.get(this._name);
          found._outputs = error._outputs, error._outputs = new Set;
          found._outputs.forEach(function(output) { output._inputs[output._inputs.indexOf(error)] = found; });
          found._definition = found._duplicate, found._duplicate = undefined;
          runtime._dirty.add(error).add(found);
          runtime._updates.add(found);
          scope.set(this._name, found);
        }
      } else {
        throw new Error;
      }
    }

    if (this._outputs.size) throw new Error;

    if (name) { // Does this variable have a new name?
      if (found = scope.get(name)) { // Do other variables reference or assign this name?
        if (found._type === TYPE_DUPLICATE) { // Do multiple other variables already define this name?
          // 继续加入现有冲突集合。
          this._definition = variable_duplicate(name), this._duplicate = definition;
          found._duplicates.add(this);
        } else if (found._type === TYPE_IMPLICIT) { // Are the variable references broken?
          // 新名字原来只是“被引用但未定义”的隐式变量：
          // 直接把这些引用挂到当前变量即可。
          this._outputs = found._outputs, found._outputs = new Set; // Now they’re fixed!
          this._outputs.forEach(function(output) { output._inputs[output._inputs.indexOf(found)] = this; }, this);
          runtime._dirty.add(found).add(this);
          scope.set(name, this);
        } else { // Does another variable define this name?
          // 发生真实重名：构造 TYPE_DUPLICATE 错误节点承接所有引用，
          // 两个真实定义都暂存到 _duplicate，等待冲突解除时恢复。
          found._duplicate = found._definition, this._duplicate = definition; // Now they’re duplicates.
          error = new Variable(TYPE_DUPLICATE, this._module);
          error._name = name;
          error._definition = this._definition = found._definition = variable_duplicate(name);
          error._outputs = found._outputs, found._outputs = new Set;
          error._outputs.forEach(function(output) { output._inputs[output._inputs.indexOf(found)] = error; });
          error._duplicates = new Set([this, found]);
          runtime._dirty.add(found).add(error);
          runtime._updates.add(found).add(error);
          scope.set(name, error);
        }
      } else {
        scope.set(name, this);
      }
    }

    this._name = name;
  }

  // If this redefined variable was previously evaluated, invalidate it. (If the
  // variable was never evaluated, then the invalidated value could never have
  // been exposed and we can avoid this extra work.)
  // 对“已求值过”的变量推进版本号，防止旧 Promise 回写覆盖新定义。
  if (this._version > 0) ++this._version;

  // 当前变量本轮一定要重算；然后触发 runtime 合并调度。
  runtime._updates.add(this);
  runtime._compute();
  return this;
}

function variable_import(remote, name, module) {
  // import 本质是定义一个 identity 变量，输入为远端模块中目标变量。
  if (arguments.length < 3) module = name, name = remote;
  return variable_defineImpl.call(this, String(name), [module._resolve(String(remote))], identity);
}

function variable_delete() {
  // delete 等价于定义为 noop 且无输入，表示“撤销定义”。
  return variable_defineImpl.call(this, null, [], noop);
}

function variable_pending() {
  // 观察者回调均做存在性判断，便于部分实现。
  if (this._observer.pending) this._observer.pending();
}

function variable_fulfilled(value) {
  if (this._observer.fulfilled) this._observer.fulfilled(value, this._name);
}

function variable_rejected(error) {
  if (this._observer.rejected) this._observer.rejected(error, this._name);
}
