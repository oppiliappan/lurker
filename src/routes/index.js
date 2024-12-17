const express = require("express");
const he = require("he");
const jwt = require("jsonwebtoken");
const crypto = require('crypto');
const geddit = require("../geddit.js");
const { JWT_KEY } = require("../");
const { db } = require("../db");
const { authenticateToken, authenticateAdmin } = require("../auth");
const { validateInviteToken } = require("../invite");

const router = express.Router();
const G = new geddit.Geddit();

function generateRandomPassword(length = 12) {
  const bytes = crypto.randomBytes(length);
  return bytes.toString('base64').slice(0, length);  // Convert to base64 and slice to desired length
}

// Helper function to set the auth token cookie
function setAuthTokenCookie(res, username, userId) {
  const token = jwt.sign({ username, id: userId }, JWT_KEY, { expiresIn: "5d" });
  res.cookie("auth_token", token, {
    httpOnly: true,
    secure: true,
    maxAge: 5 * 24 * 60 * 60 * 1000, // 5 days
    sameSite: 'Strict',
  });
}

// Middleware to check if user is logged in via HTTP headers
async function loginViaHeaders(req, res, next) {
  const remoteUser = req.headers['remote-user'] || req.headers['HTTP_AUTH_USER'];
  const remoteGroups = req.headers['remote-groups'] ? req.headers['remote-groups'].split(',') : [];

  // We need env.REMOTE_HEADER_LOGIN=true to use SSO. Also check if remoteUser header is missing
  if (!(process.env.REMOTE_HEADER_LOGIN || false) || !remoteUser) {
    if(process.env.REMOTE_HEADER_LOGIN) console.log("Remote user header missing");
    return res.redirect("/login");  // Redirect to login page if missing
  }

  // If remoteUser is present, set user info and validate
  req.user = {
    username: remoteUser,  // Store username in req.user
    isAdmin: remoteGroups.includes(process.env.ADMIN_GROUP || 'admin'),  // Check if user is an admin
    validated: true,  // Flag to mark user as validated via headers
  };

  // Check if the user already exists in the database
  let existingUser = db.query("SELECT * FROM users WHERE username = $username").get({ username: remoteUser });

  if (!existingUser) {
    // If user does not exist, automatically register them
    try {
      const randomPassword = generateRandomPassword(52);
      const hashedPassword = await Bun.password.hash(randomPassword);  // Hash the random password

      const insertedRecord = db.query(
        "INSERT INTO users (username, password_hash, isAdmin) VALUES ($username, $hashedPassword, $isAdmin)"
      ).run({
        username: remoteUser,
        hashedPassword,
        isAdmin: 0,
      });

      const userId = insertedRecord.lastInsertRowid;
      setAuthTokenCookie(res, remoteUser, userId);

      const redirectTo = req.query.direct || '/';
      return res.redirect(redirectTo);
    } catch (error) {
      console.error("Error creating user from headers:", error);
      return res.render("login", { message: "Error creating account, please try again." });
    }
  } else {
    // Set user id from the database record
    req.user.id = existingUser.id;

    // Check if the isAdmin value in the database matches the remote header
    if (remoteGroups.length > 0 && existingUser.isAdmin !== req.user.isAdmin) {
      // Update the user's isAdmin field to match the header
      db.query("UPDATE users SET isAdmin = $isAdmin WHERE id = $id")
        .run({
          isAdmin: req.user.isAdmin ? 1 : 0,
          id: req.user.id,
        });
    }

    setAuthTokenCookie(res, remoteUser, existingUser.id);
    const redirectTo = req.query.direct || '/';
    return res.redirect(redirectTo);
  }
}

// GET /
router.get("/", authenticateToken, async (req, res) => {
  const subs = db.query("SELECT * FROM subscriptions WHERE user_id = $id").all({ id: req.user.id });
  if (subs.length === 0) {
    res.redirect("/r/all");
  } else {
    const p = subs.map((s) => s.subreddit).join("+");
    res.redirect(`/r/${p}`);
  }
});

// GET /r/:id
router.get("/r/:subreddit", authenticateToken, async (req, res) => {
  const subreddit = req.params.subreddit;
  const isMulti = subreddit.includes("+");
  const query = req.query || {};
  query.sort = query.sort || "hot";

  let isSubbed = false;
  if (!isMulti) {
    isSubbed = db.query("SELECT * FROM subscriptions WHERE user_id = $id AND subreddit = $subreddit")
                 .get({ id: req.user.id, subreddit }) !== null;
  }

  const postsReq = G.getSubmissions(query.sort, subreddit, query);
  const aboutReq = G.getSubreddit(subreddit);
  const [posts, about] = await Promise.all([postsReq, aboutReq]);

  res.render("index", {
    subreddit,
    posts,
    about,
    query,
    isMulti,
    user: req.user,
    isSubbed,
  });
});

// GET /comments/:id
router.get("/comments/:id", authenticateToken, async (req, res) => {
	const id = req.params.id;

	const params = {
		limit: 50,
	};
	response = await G.getSubmissionComments(id, params);

	res.render("comments", {
		data: unescape_submission(response),
		user: req.user,
	});
});

// GET /comments/:parent_id/comment/:child_id
router.get(
	"/comments/:parent_id/comment/:child_id",
	authenticateToken,
	async (req, res) => {
		const parent_id = req.params.parent_id;
		const child_id = req.params.child_id;

		const params = {
			limit: 50,
		};
		response = await G.getSingleCommentThread(parent_id, child_id, params);
		const comments = response.comments;
		comments.forEach(unescape_comment);
		res.render("single_comment_thread", {
			comments,
			parent_id,
			user: req.user,
		});
	},
);

// GET /subs
router.get("/subs", authenticateToken, async (req, res) => {
	const subs = db
		.query(
			"SELECT * FROM subscriptions WHERE user_id = $id ORDER by LOWER(subreddit)",
		)
		.all({ id: req.user.id });

	res.render("subs", { subs, user: req.user });
});

// GET /search
router.get("/search", authenticateToken, async (req, res) => {
	res.render("search", { user: req.user });
});

// GET /sub-search
router.get("/sub-search", authenticateToken, async (req, res) => {
	if (!req.query || !req.query.q) {
		res.render("sub-search", { user: req.user });
	} else {
		const { q, options } = parseQuery(req.query.q);
		const { items, after } = await G.searchSubreddits(q, {
			include_over_18: (options.nsfw ?? "no") === "yes",
		});
		const subs = db
			.query("SELECT subreddit FROM subscriptions WHERE user_id = $id")
			.all({ id: req.user.id })
			.map((res) => res.subreddit);
		const message =
			items.length === 0
				? "no results found"
				: `showing ${items.length} results`;
		res.render("sub-search", {
			items,
			subs,
			after,
			message,
			user: req.user,
			original_query: req.query.q,
		});
	}
});

// GET /post-search
router.get("/post-search", authenticateToken, async (req, res) => {
	if (!req.query || !req.query.q) {
		res.render("post-search", { user: req.user });
	} else {
		const { q, options } = parseQuery(req.query.q);
		const { items, after } = await G.searchSubmissions(q, {
			include_over_18: (options.nsfw ?? "no") === "yes",
		});
		const message =
			items.length === 0
				? "no results found"
				: `showing ${items.length} results`;
		res.render("post-search", {
			items,
			after,
			message,
			user: req.user,
			original_query: req.query.q,
		});
	}
});

function parseQuery(q) {
	return q.split(/\s+/).reduce(
		(acc, word) => {
			if (word.includes(":")) {
				const [key, val] = word.split(":");
				acc.options[key] = val;
			} else {
				acc.q += `${word} `;
			}
			return acc;
		},
		{ options: [], q: "" },
	);
}

// GET /dashboard
router.get("/dashboard", authenticateToken, async (req, res) => {
	let invites = null;
	const isAdmin = db
		.query("SELECT isAdmin FROM users WHERE id = $id and isAdmin = 1")
		.get({
			id: req.user.id,
		});
	if (isAdmin) {
		invites = db
			.query("SELECT * FROM invites")
			.all()
			.map((inv) => ({
				...inv,
				createdAt: Date.parse(inv.createdAt),
				usedAt: Date.parse(inv.usedAt),
			}));
	}
	res.render("dashboard", { invites, isAdmin, user: req.user });
});

router.get("/create-invite", authenticateAdmin, async (req, res) => {
	function generateInviteToken() {
		const hasher = new Bun.CryptoHasher("sha256");
		return hasher.update(Math.random().toString()).digest("hex").slice(0, 10);
	}

	function createInvite() {
		const token = generateInviteToken();
		db.run("INSERT INTO invites (token) VALUES ($token)", { token });
	}

	try {
		createInvite();
		return res.redirect("/dashboard");
	} catch (err) {
		console.log(err);
		return res.send("failed to create invite");
	}
});

router.get("/delete-invite/:id", authenticateToken, async (req, res) => {
	try {
		db.run("DELETE FROM invites WHERE id = $id", { id: req.params.id });
		return res.redirect("/dashboard");
	} catch (err) {
		return res.send("failed to delete invite");
	}
});

// GET /media
router.get("/media/*", authenticateToken, async (req, res) => {
	const url = req.params[0];
	const ext = url.split(".").pop().toLowerCase();
	const kind = ["jpg", "jpeg", "png", "gif", "webp"].includes(ext)
		? "img"
		: "video";
	res.render("media", { kind, url });
});

router.get("/register", validateInviteToken, async (req, res) => {
	res.render("register", { isDisabled: false, token: req.query.token });
});

router.post("/register", validateInviteToken, async (req, res) => {
	const { username, password, confirm_password } = req.body;

	if (!username || !password || !confirm_password) {
		return res.status(400).send("All fields are required");
	}

	const user = db
		.query("SELECT * FROM users WHERE username = $username")
		.get({ username });
	if (user) {
		return res.render("register", {
			message: `user by the name "${username}" exists, choose a different username`,
		});
	}

	if (password !== confirm_password) {
		return res.render("register", {
			message: "passwords do not match, try again",
		});
	}

	try {
		const hashedPassword = await Bun.password.hash(password);

		if (!req.isFirstUser) {
			db.query(
				"UPDATE invites SET usedAt = CURRENT_TIMESTAMP WHERE id = $id",
			).run({
				id: req.invite.id,
			});
		}

		const insertedRecord = db
			.query(
				"INSERT INTO users (username, password_hash, isAdmin) VALUES ($username, $hashedPassword, $isAdmin)",
			)
			.run({
				username,
				hashedPassword,
				isAdmin: req.isFirstUser ? 1 : 0,
			});
		const id = insertedRecord.lastInsertRowid;
		setAuthTokenCookie(res, username, id);
		res.status(200).redirect("/");
	} catch (err) {
		return res.render("register", {
			message: "error registering user, try again later",
		});
	}
});

// GET /login
router.get("/login", async (req, res, next) => {
  const token = req.cookies.auth_token;
  if (token) {
    return res.redirect("/");
  }
  if (req.headers['remote-user']) {
    return loginViaHeaders(req, res, next); 
  }
  res.render("login", { message: req.query.message });
});

// POST /login (form submission)
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.render("login", { message: "Both username and password are required." });
  }

  const user = db.query("SELECT * FROM users WHERE username = $username").get({ username });

  if (user && (await Bun.password.verify(password, user.password_hash))) {
    try {
      setAuthTokenCookie(res, username, user.id);
      const redirectTo = req.query.direct || '/';
      return res.redirect(redirectTo);
    } catch (error) {
      console.error("Error signing JWT:", error);
      res.render("login", { message: "Something went wrong, try again later." });
    }
  } else {
    // Invalid credentials
    res.render("login", { message: "Invalid credentials, try again." });
  }
});

// GET /logout (clear JWT and log out user)
router.get("/logout", (req, res) => {
  res.clearCookie("auth_token", { httpOnly: true, secure: true });
  res.redirect("/login");
});

// POST /subscribe
router.post("/subscribe", authenticateToken, async (req, res) => {
	const { subreddit } = req.body;
	const user = req.user;
	const existingSubscription = db
		.query(
			"SELECT * FROM subscriptions WHERE user_id = $id AND subreddit = $subreddit",
		)
		.get({ id: user.id, subreddit });
	if (existingSubscription) {
		res.status(400).send("Already subscribed to this subreddit");
	} else {
		db.query(
			"INSERT INTO subscriptions (user_id, subreddit) VALUES ($id, $subreddit)",
		).run({ id: user.id, subreddit });
		res.status(201).send("Subscribed successfully");
	}
});

router.post("/unsubscribe", authenticateToken, async (req, res) => {
	const { subreddit } = req.body;
	const user = req.user;
	const existingSubscription = db
		.query(
			"SELECT * FROM subscriptions WHERE user_id = $id AND subreddit = $subreddit",
		)
		.get({ id: user.id, subreddit });
	if (existingSubscription) {
		db.query(
			"DELETE FROM subscriptions WHERE user_id = $id AND subreddit = $subreddit",
		).run({ id: user.id, subreddit });
		res.status(200).send("Unsubscribed successfully");
	} else {
		res.status(400).send("Subscription not found");
	}
});

module.exports = router;

function unescape_submission(response) {
	const post = response.submission.data;
	const comments = response.comments;

	if (post.selftext_html) {
		post.selftext_html = he.decode(post.selftext_html);
	}
	comments.forEach(unescape_comment);

	return { post, comments };
}

function unescape_comment(comment) {
	if (comment.data.body_html) {
		comment.data.body_html = he.decode(comment.data.body_html);
	}
	if (comment.data.replies) {
		if (comment.data.replies.data) {
			if (comment.data.replies.data.children) {
				comment.data.replies.data.children.forEach(unescape_comment);
			}
		}
	}
}
