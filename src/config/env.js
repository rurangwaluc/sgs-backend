// backend/src/config/env.js
"use strict";

const path = require("path");
const dotenv = require("dotenv");

dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
  override: true,
});

function required(name, v) {
  const val = String(v ?? "").trim();
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optional(_name, v) {
  const val = String(v ?? "").trim();
  return val || null;
}

function parseBool(v, fallback = false) {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  if (!s) return fallback;
  return s === "true" || s === "1" || s === "yes";
}

function normalizeOrigin(value) {
  return String(value ?? "")
    .trim()
    .replace(/\/+$/, "");
}

function parseOrigins(value) {
  return String(value || "http://localhost:3000")
    .split(",")
    .map((s) => normalizeOrigin(s))
    .filter(Boolean);
}

function parseSameSite(v, fallback = "lax") {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  if (!s) return fallback;
  if (["lax", "strict", "none"].includes(s)) return s;
  return fallback;
}

const nodeEnv = String(process.env.NODE_ENV || "development").trim();
const isProd = nodeEnv === "production";

const cookieSameSite = parseSameSite(
  process.env.COOKIE_SAME_SITE,
  isProd ? "none" : "lax",
);

const cookieSecure = parseBool(
  process.env.COOKIE_SECURE,
  isProd || cookieSameSite === "none",
);

const env = {
  NODE_ENV: nodeEnv,
  PORT: Number(process.env.PORT || 4000),

  DATABASE_URL: required("DATABASE_URL", process.env.DATABASE_URL),

  PG_SSL: parseBool(process.env.PG_SSL, true),
  PG_SSL_REJECT_UNAUTHORIZED: parseBool(
    process.env.PG_SSL_REJECT_UNAUTHORIZED,
    false,
  ),

  SESSION_SECRET: required("SESSION_SECRET", process.env.SESSION_SECRET),

  CORS_ORIGINS: parseOrigins(process.env.CORS_ORIGINS),

  BOOTSTRAP_SECRET: optional("BOOTSTRAP_SECRET", process.env.BOOTSTRAP_SECRET),

  COOKIE_DOMAIN: optional("COOKIE_DOMAIN", process.env.COOKIE_DOMAIN),
  COOKIE_SECURE: cookieSecure,
  COOKIE_SAME_SITE: cookieSameSite,
};

module.exports = { env };
