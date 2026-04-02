const crypto = require('crypto');
const { Pool } = require('pg');

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) return reject(err);
      resolve(salt + ':' + derived.toString('hex'));
    });
  });
}

async function main() {
  const username = process.argv[2];
  const password = process.argv[3];
  const name = process.argv[4] || username;

  if (!username || !password) {
    console.error('Usage: node create-user.js <username> <password> [name]');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const hash = await hashPassword(password);

  const email = process.argv[5] || null;
  const phone = process.argv[6] || null;

  const result = await pool.query(
    `INSERT INTO "PanelUser" (username, "passwordHash", name, role, email, phone)
     VALUES ($1, $2, $3, 'admin', $4, $5)
     ON CONFLICT (username) DO UPDATE SET "passwordHash" = $2, name = $3, email = COALESCE($4, "PanelUser".email), phone = COALESCE($5, "PanelUser".phone), "updatedAt" = NOW()
     RETURNING id, username, name, role, email, phone`,
    [username, hash, name, email, phone]
  );

  console.log('User created:', result.rows[0]);
  await pool.end();
}

main().catch(err => { console.error(err.message); process.exit(1); });
