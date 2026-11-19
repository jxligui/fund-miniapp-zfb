/**
 * 用支付宝开发者工具自带的 JSON Schema 校验项目配置。
 * Schema 位置：
 *   %APPDATA%/.mini-ide/extension-storage/alipay.minicode/json-schemas/
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCHEMA_DIR = path.join(
  os.homedir(), 'AppData', 'Roaming', '.mini-ide',
  'extension-storage', 'alipay.minicode', 'json-schemas'
);

function loadSchema(name) {
  const p = path.join(SCHEMA_DIR, name);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// 递归解析 $ref
function resolve(schema, root) {
  if (schema && schema.$ref) {
    const pathParts = schema.$ref.replace(/^#\//, '').split('/');
    let node = root;
    for (const part of pathParts) {
      node = node[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    }
    return resolve(node, root);
  }
  return schema;
}

/** 找出对象里 schema 不允许的键 */
function validateObject(obj, schema, root, pathStr, errors) {
  schema = resolve(schema, root);
  if (!schema || typeof schema !== 'object') return;
  if (schema.anyOf) {
    // 取第一个能通过的分支
    const ok = schema.anyOf.some(branch => {
      const local = [];
      validateObject(obj, branch, root, pathStr, local);
      if (local.length === 0) return true;
      errors.push(...local);
      return false;
    });
    if (!ok) return;
    return;
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return;

  const props = schema.properties || {};
  const allowAdditional = schema.additionalProperties !== false;

  for (const [key, value] of Object.entries(obj)) {
    const propSchema = props[key];
    if (!propSchema) {
      if (!allowAdditional) {
        errors.push(`${pathStr}.${key}  —— 不支持的属性（允许：${Object.keys(props).join(', ')}）`);
      }
      continue;
    }
    // 枚举 / const 校验
    const resolved = resolve(propSchema, root);
    if (resolved.anyOf) {
      // anyOf 里可能有 boolean 形式；选第一个有 properties 的分支深入校验
      const branch = resolved.anyOf.find(b => b.properties) || resolved.anyOf[0];
      if (branch && branch.properties) {
        validateObject(value, branch, root, `${pathStr}.${key}`, errors);
      }
      continue;
    }
    if (resolved.enum && !resolved.enum.includes(value)) {
      errors.push(`${pathStr}.${key}  —— 值 "${value}" 不在允许范围 [${resolved.enum.join(', ')}]`);
    }
    if (resolved.const !== undefined && value !== resolved.const) {
      errors.push(`${pathStr}.${key}  —— 值必须为 "${resolved.const}"，当前 "${value}"`);
    }
    // 嵌套
    if (resolved.type === 'object' && resolved.properties) {
      validateObject(value, resolved, root, `${pathStr}.${key}`, errors);
    }
    if (resolved.type === 'array' && resolved.items) {
      const items = resolve(resolved.items, root);
      value.forEach((v, i) => {
        if (items.properties) validateObject(v, items, root, `${pathStr}.${key}[${i}]`, errors);
      });
    }
  }
}

function check(fileRel, schemaName) {
  const root = path.resolve(__dirname, '..');
  const filePath = path.join(root, fileRel);
  if (!fs.existsSync(filePath)) {
    console.log(`\n[跳过] ${fileRel} 不存在`);
    return 0;
  }
  let obj;
  try {
    obj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.log(`\n[${fileRel}] JSON 解析失败: ${e.message}`);
    return 1;
  }
  // mini.project.json 按 format 选择 v1 / v2 schema
  let schemaFile = schemaName;
  if (schemaName === 'mini-project.schema.json') {
    schemaFile = obj.format === 2 ? 'mini-project.v2.schema.json' : 'mini-project.schema.json';
  }
  const schema = loadSchema(schemaFile);
  const errors = [];
  validateObject(obj, schema, schema, fileRel, errors);
  if (!errors.length) {
    console.log(`[OK]   ${fileRel}  符合 ${schemaFile}`);
    return 0;
  }
  console.log(`\n[${fileRel}]  发现 ${errors.length} 个问题：`);
  errors.forEach(e => console.log('   - ' + e));
  return errors.length;
}

let total = 0;
total += check('mini.project.json', 'mini-project.schema.json');
total += check('app.json', 'app.schema.json');
for (const page of ['index', 'watch', 'holdings', 'login', 'detail']) {
  total += check(`pages/${page}/${page}.json`, 'page.schema.json');
}
console.log(total === 0 ? '\nPASS: 所有配置均符合支付宝 schema' : `\n共 ${total} 个问题`);
process.exitCode = total === 0 ? 0 : 1;
