import {constant} from "./constant.js";
import {RuntimeError} from "./errors.js";
import {identity} from "./identity.js";
import {rethrow} from "./rethrow.js";
import {Variable, TYPE_DUPLICATE, TYPE_IMPLICIT, TYPE_NORMAL, no_observer, variable_stale} from "./variable.js";

// 这三个符号是运行时保留的“特殊输入占位符”：
// 1) @variable: 注入当前变量对象本身
// 2) invalidation: 注入失效 Promise，用于清理副作用
// 3) visibility: 注入可见性函数（与 IntersectionObserver 协作）
export const variable_variable = Symbol("variable");
export const variable_invalidation = Symbol("invalidation");
export const variable_visibility = Symbol("visibility");

// Module 表示一个命名作用域容器：
// - _scope 保存“变量名 -> Variable”映射；
// - _builtins 保存模块内建值（可覆盖 runtime 级内建）；
// - _source 仅在 derive 场景下使用，指向“派生自哪个源模块”。
export function Module(runtime, builtins = []) {
  Object.defineProperties(this, {
    _runtime: {value: runtime},
    _scope: {value: new Map},
    _builtins: {value: new Map([
      ["@variable", variable_variable],
      ["invalidation", variable_invalidation],
      ["visibility", variable_visibility],
      ...builtins
    ])},
    _source: {value: null, writable: true}
  });
}

// 将对外 API 挂到原型，便于后续按方法粒度替换/测试。
Object.defineProperties(Module.prototype, {
  _resolve: {value: module_resolve, writable: true, configurable: true},
  redefine: {value: module_redefine, writable: true, configurable: true},
  define: {value: module_define, writable: true, configurable: true},
  derive: {value: module_derive, writable: true, configurable: true},
  import: {value: module_import, writable: true, configurable: true},
  value: {value: module_value, writable: true, configurable: true},
  variable: {value: module_variable, writable: true, configurable: true},
  builtin: {value: module_builtin, writable: true, configurable: true}
});

// 按名称重定义已存在变量。
// 约束：
// - 名称不存在时抛错；
// - 名称处于 duplicate 冲突态时不允许 redefine；
// - 其余情况委托给目标 Variable.define，保持 define 的参数兼容行为。
function module_redefine(name) {
  const v = this._scope.get(name);
  if (!v) throw new RuntimeError(`${name} is not defined`);
  if (v._type === TYPE_DUPLICATE) throw new RuntimeError(`${name} is defined more than once`);
  return v.define.apply(v, arguments);
}

// 创建一个普通变量并立即定义。
// 该方法是 module.define(...) 的主体实现。
function module_define() {
  const v = new Variable(TYPE_NORMAL, this);
  return v.define.apply(v, arguments);
}

// 创建一个普通变量并将其定义为 import 代理。
// 语义等价于先 variable() 再调用 variable.import(...)。
function module_import() {
  const v = new Variable(TYPE_NORMAL, this);
  return v.import.apply(v, arguments);
}

// 仅分配一个普通变量实例，不做 define/import。
// 常用于外部手动分步构建变量（例如先拿句柄，再决定何时 define）。
function module_variable(observer, options) {
  return new Variable(TYPE_NORMAL, this, observer, options);
}

// 获取 name 的“下一次可用值”。
// 关键点：
// - 如果目标变量不可达（无 observer），会临时创建一个观察变量把它拉到可达集合；
// - 读取完成后在 finally 中删除这个临时变量，避免长期订阅；
// - 若目标在等待期间被 redefine，内部会通过 module_revalue 自动重试。
async function module_value(name) {
  let v = this._scope.get(name);
  if (!v) throw new RuntimeError(`${name} is not defined`);
  if (v._observer === no_observer) {
    v = this.variable(true).define([name], identity);
    try {
      return await module_revalue(this._runtime, v);
    } finally {
      v.delete();
    }
  } else {
    return module_revalue(this._runtime, v);
  }
}

// 等待 runtime 完成一轮调度后读取变量 Promise。
// 若命中 variable_stale，说明读取期间发生了重定义，递归重试直到得到稳定结果。
async function module_revalue(runtime, variable) {
  await runtime._compute();
  try {
    return await variable._promise;
  } catch (error) {
    if (error === variable_stale) return module_revalue(runtime, variable);
    throw error;
  }
}

// 派生模块（import-with）的两阶段复制流程：
// 1) 先创建“别名模块壳”（alias），建立 source->target 映射，并注入 overrides；
// 2) 再复制变量定义：对 import 保持跨模块引用关系，对普通定义复制 inputs+definition。
// 这样可以确保：直接注入和传递注入都能生效，同时避免复制顺序导致的解析偏差。
function module_derive(injects, injectModule) {
  const map = new Map();
  const modules = new Set();
  const copies = [];

  // 为给定源模块创建（或复用）一个“派生目标模块”。
  // 此阶段只建壳，不复制变量；变量复制在后面的 second pass 统一处理。
  function alias(source) {
    let target = map.get(source);
    if (target) return target;
    target = new Module(source._runtime, source._builtins);
    target._source = source;
    map.set(source, target);
    copies.push([target, source]);
    modules.add(source);
    return target;
  }

  // 第一步：把注入变量先写进 derive（本质是反向 import）。
  // 支持两种输入："name" 或 {name, alias}。
  const derive = alias(this);
  for (const inject of injects) {
    const {alias, name} = typeof inject === "object" ? inject : {name: inject};
    derive.import(name, alias == null ? name : alias, injectModule);
  }

  // 第二步：识别并纳入“传递 import-with”。
  // 如果某个 import 指向的模块本身有 _source，说明它是 derive 产物；
  // 这类模块也需要被 alias，避免直接注入只影响第一层、不影响传递层。
  for (const module of modules) {
    for (const [name, variable] of module._scope) {
      if (variable._definition === identity) { // import
        if (module === this && derive._scope.has(name)) continue; // overridden by injection
        const importedModule = variable._inputs[0]._module;
        if (importedModule._source) alias(importedModule);
      }
    }
  }

  // 第三步：在模块关系稳定后再复制变量定义。
  // - import 变量：复制“从哪个模块导入哪个名字”的关系；
  // - 非 import 变量：复制定义函数和输入变量名；
  // - 若目标已有显式注入（非隐式变量），保持注入优先，不覆盖。
  for (const [target, source] of copies) {
    for (const [name, sourceVariable] of source._scope) {
      const targetVariable = target._scope.get(name);
      if (targetVariable && targetVariable._type !== TYPE_IMPLICIT) continue; // preserve injection
      if (sourceVariable._definition === identity) { // import
        const sourceInput = sourceVariable._inputs[0];
        const sourceModule = sourceInput._module;
        target.import(sourceInput._name, name, map.get(sourceModule) || sourceModule);
      } else { // non-import
        target.define(name, sourceVariable._inputs.map(variable_name), sourceVariable._definition);
      }
    }
  }

  return derive;
}

// 名称解析入口（按优先级）：
// 1) 当前模块 _scope 已存在 -> 直接返回；
// 2) 模块级 builtins -> 绑定常量；
// 3) runtime 内建模块 -> 通过 import 引入；
// 4) 全局对象查询 -> 有值则绑定常量，无值则保留隐式未定义变量。
// 若全局查询抛错，用 rethrow(error) 生成延迟抛错定义，保持求值链一致。
function module_resolve(name) {
  let variable = this._scope.get(name), value;
  if (!variable) {
    variable = new Variable(TYPE_IMPLICIT, this);
    if (this._builtins.has(name)) {
      variable.define(name, constant(this._builtins.get(name)));
    } else if (this._runtime._builtin._scope.has(name)) {
      variable.import(name, this._runtime._builtin);
    } else {
      try {
        value = this._runtime._global(name);
      } catch (error) {
        return variable.define(name, rethrow(error));
      }
      if (value === undefined) {
        this._scope.set(variable._name = name, variable);
      } else {
        variable.define(name, constant(value));
      }
    }
  }
  return variable;
}

// 注册（或覆盖）当前模块的内建值。
// 后续 module_resolve(name) 会优先命中这里。
function module_builtin(name, value) {
  this._builtins.set(name, value);
}

// 从变量对象提取名称，用于复制定义时把 inputs 映射为 name 数组。
function variable_name(variable) {
  return variable._name;
}
