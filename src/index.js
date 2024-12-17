const express = require("express");
const rateLimit = require("express-rate-limit");
const path = require("node:path");
const geddit = require("./geddit.js");
const cookieParser = require("cookie-parser");
const app = express();
const hasher = new Bun.CryptoHasher("sha256", "secret-key");
const JWT_KEY = process.env.JWT_SECRET_KEY || hasher.update(Math.random().toString()).digest("hex");
const trustedProxyIPs = (process.env.REVERSE_PROXY_WHITELIST || '').split(',').map(ip => ip.trim());

console.log("JWT_SECRET_KEY:", process.env.JWT_SECRET_KEY);
console.log("Using JWT_KEY:", JWT_KEY);  // This is the key that will be used for signing and verifying the JWT

module.exports = { JWT_KEY };

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");

const routes = require("./routes/index");
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "assets")));
app.use(cookieParser());
if ((process.env.REMOTE_HEADER_LOGIN || false)) {
    // Set trust proxy dynamically based on trustedProxyIPs, fallback to '1'
    if (trustedProxyIPs.some(ip => ip)) {
        const trustProxyRanges = trustedProxyIPs.join(",");
        console.log("Trusting proxies in range:", trustProxyRanges);
        app.set('trust proxy', trustProxyRanges);
    } else {
        console.warn('No valid IPs in REVERSE_PROXY_WHITELIST. Falling back to trust proxy: 1.');
        app.set('trust proxy', 1);
    }
}
app.use(
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: (process.env.RATE_LIMIT || 100),
        message: "Too many requests from this IP, please try again later.",
        standardHeaders: true,
        legacyHeaders: false,
    }),
);
app.use("/", routes);

const port = process.env.LURKER_PORT;
const server = app.listen(port ? port : 3000, () => {
    console.log(`started on ${server.address().port}`);
});
