const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const env = {};

const content = fs.readFileSync(path.join(root, ".env"), "utf8");

for (const line of content.split(/\r?\n/)) {
  const text = line.trim();
  if (!text || text.startsWith("#")) continue;

  const index = text.indexOf("=");
  if (index < 0) continue;

  const key = text.slice(0, index).trim();
  const value = text.slice(index + 1).trim();
  env[key] = value;
}

const fields = {
  apiKey: "FIREBASE_API_KEY",
  authDomain: "FIREBASE_AUTH_DOMAIN",
  databaseURL: "FIREBASE_DATABASE_URL",
  projectId: "FIREBASE_PROJECT_ID",
  storageBucket: "FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "FIREBASE_MESSAGING_SENDER_ID",
  appId: "FIREBASE_APP_ID",
};

const config = {};

for (const [field, variable] of Object.entries(fields)) {
  if (!env[variable]) {
    throw new Error(`.env 缺少 ${variable}`);
  }
  config[field] = env[variable];
}

fs.writeFileSync(
  path.join(root, "public", "firebase-config.js"),
  `export const firebaseConfig = ${JSON.stringify(config, null, 2)};\n`
);

console.log("已產生 Firebase 設定");