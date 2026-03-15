import express from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { dbHelpers } from "../db/database.js";
import {
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  authenticateToken,
} from "../middleware/auth.js";

const router = express.Router();

// Agent Registration (Requires Human Authentication)
router.post("/register", authenticateToken, async (req, res) => {
  try {
    const { passphrase, display_name, account_type } = req.body;

    if (!passphrase || !display_name || account_type !== "agent") {
      return res.status(400).json({ error: "Invalid agent registration payload" });
    }

    if (passphrase.length < 8) {
      return res.status(400).json({ error: "Passphrase must be at least 8 characters" });
    }

    // Check if display name is already taken
    const existingUser = dbHelpers.getUserByDisplayName(display_name);
    if (existingUser) {
      return res.status(400).json({ error: "Display name is already taken" });
    }

    const userId = uuidv4();
    const dummyEmail = `agent_${userId}@agent.local`;

    const passwordHash = await bcrypt.hash(passphrase, 10);
    const ownerId = req.user.userId;

    dbHelpers.createUser(userId, dummyEmail, passwordHash, display_name, account_type, null, ownerId);

    // Create user preferences and stats
    dbHelpers.createUserPreferences(uuidv4(), userId);
    dbHelpers.createUserStats(uuidv4(), userId);

    const accessToken = generateToken(userId, dummyEmail);
    const refreshToken = generateRefreshToken(userId, dummyEmail);

    const user = dbHelpers.getUserById(userId);

    res.status(201).json({
      message: "Agent created successfully",
      user: {
        id: user.id,
        displayName: user.display_name,
        account_type: user.account_type,
        createdAt: user.created_at,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error("Agent registration error:", error);
    res.status(500).json({ error: "Failed to create agent" });
  }
});
router.post("/signup", async (req, res) => {
  try {
    const { email, password, displayName } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters" });
    }

    // Check if user already exists
    const existingUser = dbHelpers.getUserByEmail(email);
    if (existingUser) {
      return res
        .status(400)
        .json({ error: "User with this email already exists" });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const userId = uuidv4();
    dbHelpers.createUser(userId, email, passwordHash, displayName);

    // Create user preferences and stats
    dbHelpers.createUserPreferences(uuidv4(), userId);
    dbHelpers.createUserStats(uuidv4(), userId);

    // Generate tokens
    const accessToken = generateToken(userId, email);
    const refreshToken = generateRefreshToken(userId, email);

    // Get user data
    const user = dbHelpers.getUserById(userId);
    const preferences = dbHelpers.getUserPreferences(userId);
    const stats = dbHelpers.getUserStats(userId);

    res.status(201).json({
      message: "User created successfully",
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        createdAt: user.created_at,
      },
      preferences,
      stats,
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error("Sign up error:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
});

// Sign In
router.post("/signin", async (req, res) => {
  console.log("--> SIGNIN REQUEST RECEIVED:", req.body);
  try {
    const { email, password, displayName, passphrase } = req.body;

    let user;

    if (email && password) {
      console.log("--> Human auth flow...");
      // Human auth flow
      user = dbHelpers.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const isValidPassword = await bcrypt.compare(password, user.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({ error: "Invalid email or password" });
      }
    } else if (displayName && passphrase) {
      console.log("--> Agent auth flow... DisplayName:", displayName);
      // Agent auth flow
      user = dbHelpers.getUserByDisplayName(displayName);
      console.log("--> User found:", user ? user.id : "NO");
      if (!user) {
        return res.status(401).json({ error: "Invalid display name or passphrase" });
      }

      console.log("--> Comparing passwords...");
      const isValidPassword = await bcrypt.compare(passphrase, user.password_hash);
      console.log("--> Password valid:", isValidPassword);
      if (!isValidPassword) {
        return res.status(401).json({ error: "Invalid display name or passphrase" });
      }
    } else {
      console.log("--> Missing credentials");
      return res.status(400).json({ error: "Missing required credentials" });
    }

    console.log("--> Generating tokens for", user.email);
    // Generate tokens
    const accessToken = generateToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id, user.email);

    console.log("--> Getting preferences and stats...");
    // Get user preferences and stats
    const preferences = dbHelpers.getUserPreferences(user.id);
    const stats = dbHelpers.getUserStats(user.id);

    console.log("--> Sending response...");
    res.json({
      message: "Sign in successful",
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        createdAt: user.created_at,
      },
      preferences,
      stats,
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error("Sign in error:", error);
    res.status(500).json({ error: "Failed to sign in" });
  }
});

// Refresh Token
router.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token required" });
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);

    // Get user
    const user = dbHelpers.getUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // Generate new tokens
    const accessToken = generateToken(user.id, user.email);
    const newRefreshToken = generateRefreshToken(user.id, user.email);

    res.json({
      accessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    console.error("Refresh token error:", error);
    res.status(401).json({ error: "Invalid refresh token" });
  }
});

// Sign Out (client-side only, but endpoint for consistency)
router.post("/signout", (req, res) => {
  res.json({ message: "Signed out successfully" });
});

export default router;
