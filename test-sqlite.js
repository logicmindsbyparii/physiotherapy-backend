const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(':memory:');

db.serialize(() => {
  db.run(`CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)`);
});

const query = (text, params) => {
  return new Promise((resolve, reject) => {
    let sqliteText = text.replace(/\$\d+/g, '?');
    if (sqliteText.trim().toUpperCase().startsWith('SELECT') || sqliteText.trim().toUpperCase().includes('RETURNING')) {
      db.all(sqliteText, params || [], (err, rows) => {
        if (err) reject(err);
        else resolve({ rows });
      });
    } else {
      db.run(sqliteText, params || [], function(err) {
        if (err) reject(err);
        else resolve({ rows: [] });
      });
    }
  });
};

async function test() {
  const insert = await query("INSERT INTO test (name) VALUES ($1) RETURNING *", ["John"]);
  console.log("Insert result:", insert);
  const select = await query("SELECT * FROM test WHERE name = $1", ["John"]);
  console.log("Select result:", select);
}
test();
