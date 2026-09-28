// Merge recursivo usado para combinar las opciones de informe que envía el
// usuario con la plantilla por defecto. NO filtra claves peligrosas
// (__proto__, constructor, prototype): de ahí la contaminación de prototipo.

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function deepMerge(target, source) {
  for (const key in source) {
    if (isObject(source[key])) {
      if (!isObject(target[key])) {
        target[key] = {};
      }
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

module.exports = { deepMerge };
