const jwt = require("jsonwebtoken");
const { db } = require("./db");
const { JWT_KEY } = require("./");

// Helper function to log token issues
function logTokenError(message, error) {
  console.error(message, error);
}

// Middleware to authenticate using JWT token (from cookies)
function authenticateToken(req, res, next) {
  const token = req.cookies && req.cookies.auth_token;
  const remoteGroups = req.headers['remote-groups'] ? req.headers['remote-groups'].split(',') : [];
  const isAdmin = remoteGroups.includes(process.env.ADMIN_GROUP || 'admin') ? 1 : 0;

  if (!token) {
    console.log("No token found, redirecting to login.");
    return res.redirect(`/login?redirect=${encodeURIComponent(req.originalUrl)}`);
  }

  try {
    console.log("Verifying token...");
    const decoded = jwt.verify(token, JWT_KEY);
    console.log("Token verified for user:", decoded);

    let dbUser;
    try {
      dbUser = db.query("SELECT * FROM users WHERE username = $username").get({ username: decoded.username });
    } catch (err) {
      console.log("Database error:", err);
      return res.redirect("/login?message=Database error.");
    }

    if (!dbUser) {
      console.log("User not found in database for token:", decoded.username);
      return res.redirect("/login?message=User not found.");
    } else {
      if ((process.env.REMOTE_HEADER_LOGIN || false) && remoteGroups.length > 0 && dbUser.isAdmin !== isAdmin) {
        db.query("UPDATE users SET isAdmin = $isAdmin WHERE id = $id")
          .run({
            isAdmin: isAdmin,
            id: dbUser.id,
          });
        console.log(`Updated isAdmin=${isAdmin} for ${decoded.username} - ${dbUser.id} in database.`);
      }
    }

    req.user = dbUser; // Attach the actual user object to the request
    next(); // Proceed to next middleware
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      console.log("Token expired:", error);
      return res.redirect(`/login?redirect=${encodeURIComponent(req.originalUrl)}&message=Session expired`);
    }
    logTokenError("Token verification failed:", error);
    res.redirect(`/login?redirect=${encodeURIComponent(req.originalUrl)}`);
  }
}

// Middleware to authenticate admin (checks if user has admin privileges)
function authenticateAdmin(req, res, next) {
  const token = req.cookies && req.cookies.auth_token;
  const remoteGroups = req.headers['remote-groups'] ? req.headers['remote-groups'].split(',') : [];
  const isAdmin = remoteGroups.includes(process.env.ADMIN_GROUP || 'admin') ? 1 : 0;

  if (!token) {
    console.log("No token found, redirecting to login for admin.");
    return res.redirect(`/login?redirect=${encodeURIComponent(req.originalUrl)}`);
  }

  try {
    console.log("Verifying token for admin...");
    const decoded = jwt.verify(token, JWT_KEY);
    console.log("Admin token verified for user:", decoded);

    let dbUser;
    try {
      dbUser = db.query("SELECT * FROM users WHERE username = $username").get({ username: decoded.username });
    } catch (err) {
      console.log("Database error:", err);
      return res.redirect("/login?message=Database error.");
    }

    if (!dbUser) {
      console.log("Admin user not found in database for token:", decoded.username);
      return res.redirect("/login?message=Admin user not found.");
    } else {
      if ((process.env.REMOTE_HEADER_LOGIN || false) && remoteGroups.length > 0 && dbUser.isAdmin !== isAdmin) {
        db.query("UPDATE users SET isAdmin = $isAdmin WHERE id = $id")
          .run({
            isAdmin: isAdmin,  // Update to 1 for admin, 0 for non-admin
            id: dbUser.id,
          });
        console.log(`Updated isAdmin=${isAdmin} for ${decoded.username} - ${dbUser.id} in database.`);
      }
    }

    req.user = dbUser;
    if (dbUser.isAdmin) {
      return next();
    } else {
      console.log("User is not an admin:", dbUser.username);
      return res.status(403).send("Only admins can access this route.");
    }
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      console.log("Admin token expired:", error);
      return res.redirect(`/login?redirect=${encodeURIComponent(req.originalUrl)}&message=Session expired`);
    }
    logTokenError("Admin token verification failed:", error);
    res.redirect(`/login?redirect=${encodeURIComponent(req.originalUrl)}`);
  }
}

module.exports = { authenticateToken, authenticateAdmin };
