/* Tiny JSON-file store. Fine for one ranch (tens of stalls, hundreds of owners,
   thousands of updates). When this becomes a real app with many users, move the
   same collections to Postgres; the route code only touches store.data + save(). */
const fs = require('fs');
const fsp = fs.promises;

function createStore(file, defaults) {
  const data = JSON.parse(JSON.stringify(defaults));
  try {
    Object.assign(data, JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (_) { /* first run */ }
  for (const k of Object.keys(defaults)) if (!(k in data)) data[k] = JSON.parse(JSON.stringify(defaults[k]));

  let chain = Promise.resolve();
  function save() {
    const snapshot = JSON.stringify(data);
    chain = chain
      .then(() => fsp.writeFile(file + '.tmp', snapshot))
      .then(() => fsp.rename(file + '.tmp', file))
      .catch((err) => console.error('[store] save failed for', file, err));
    return chain;
  }
  return { data, save };
}

module.exports = { createStore };
