require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();

// Enhanced CORS configuration
const allowedOrigins = [
  "http://localhost:8080",
  "https://recipe-book-39501.web.app",
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // Enable pre-flight for all routes
app.use(express.json());

// MongoDB connection with proper error handling
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nfwtcj8.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  connectTimeoutMS: 10000,
  socketTimeoutMS: 30000,
});

// Enhanced token validation middleware
function validateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const base64Payload = token.split(".")[1];
    const payload = JSON.parse(Buffer.from(base64Payload, "base64").toString());
    req.user = payload;
    next();
  } catch (err) {
    console.error("Token validation error:", err);
    return res.status(401).json({ message: "Invalid token" });
  }
}

async function run() {
  try {
    await client.connect();
    console.log("Connected to MongoDB Atlas");

    const db = client.db("recipe-book");
    const collection = db.collection("recipes");

    // Health check endpoint
    app.get("/health", (req, res) => {
      res.status(200).json({
        status: "ok",
        db: client.topology.isConnected() ? "connected" : "disconnected",
      });
    });

    // Basic routes
    app.get("/", (req, res) => {
      res.send("Welcome to the Recipe Book API");
    });

    // Auth check endpoint
    app.get("/auth-check", (req, res) => {
      const authHeader = req.headers["authorization"];
      if (authHeader) {
        res.status(200).json({
          message: "Auth header received",
          headerLength: authHeader.length,
        });
      } else {
        res.status(200).json({ message: "No auth header received" });
      }
    });

    // Recipe endpoints
    app.get("/api/recipes/count", async (req, res) => {
      try {
        const count = await collection.countDocuments();
        res.json({ count });
      } catch (err) {
        console.error("Count error:", err);
        res.status(500).json({ error: "Failed to get total recipes count" });
      }
    });

    app.get("/api/recipes/my/count", async (req, res) => {
      const userId = req.query.userId;
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }
      try {
        const count = await collection.countDocuments({ userId });
        res.json({ count });
      } catch (err) {
        console.error("My count error:", err);
        res.status(500).json({ error: "Failed to get my recipes count" });
      }
    });

    app.get("/api/recipes/top", async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 6;
        const recipes = await collection
          .find()
          .sort({ likes: -1 })
          .limit(limit)
          .toArray();
        res.status(200).json(recipes);
      } catch (error) {
        console.error("Top recipes error:", error);
        res.status(500).json({
          message: "Failed to fetch top recipes",
          error: error.message,
        });
      }
    });

    app.get("/api/recipes/my", async (req, res) => {
      const userId = req.query.userId;
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      try {
        const recipes = await collection.find({ userId }).toArray();
        res.status(200).json(recipes);
      } catch (err) {
        console.error("My recipes error:", err);
        res.status(500).json({
          error: "Failed to get my recipes",
          details: err.message,
        });
      }
    });

    app.get("/api/recipes/:id", async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid recipe ID format" });
      }

      try {
        const recipe = await collection.findOne({ _id: new ObjectId(id) });
        if (!recipe) {
          return res.status(404).json({ message: "Recipe not found" });
        }
        res.status(200).json(recipe);
      } catch (error) {
        console.error("Get recipe error:", error);
        res.status(500).json({
          message: "Failed to fetch recipe",
          error: error.message,
        });
      }
    });

    app.post("/api/recipes", validateToken, async (req, res) => {
      try {
        const newRecipe = {
          ...req.body,
          userId: req.user.uid,
          userName: req.user.email.split("@")[0],
          likes: 0,
          likedBy: [],
          createdAt: new Date(),
        };

        const result = await collection.insertOne(newRecipe);
        res.status(201).json({ ...newRecipe, _id: result.insertedId });
      } catch (error) {
        console.error("Create recipe error:", error);
        res.status(400).json({
          message: "Failed to create recipe",
          error: error.message,
        });
      }
    });

    app.put("/api/recipes/:id", async (req, res) => {
      try {
        const id = new ObjectId(req.params.id);
        const recipe = await collection.findOne({ _id: id });

        if (!recipe) {
          return res.status(404).json({ message: "Recipe not found" });
        }

        if (
          !req.body.userId ||
          String(recipe.userId) !== String(req.body.userId)
        ) {
          return res.status(403).json({ message: "Not authorized" });
        }

        if (req.body._id) delete req.body._id;

        const result = await collection.findOneAndUpdate(
          { _id: id },
          { $set: req.body },
          { returnDocument: "after" }
        );

        if (!result) {
          return res.status(400).json({ message: "Failed to update recipe" });
        }

        res.status(200).json(result.value);
      } catch (error) {
        console.error("Update recipe error:", error);
        res.status(400).json({
          message: "Failed to update recipe",
          error: error.message,
        });
      }
    });

    app.delete("/api/recipes/:id", async (req, res) => {
      try {
        const id = new ObjectId(req.params.id);
        const recipe = await collection.findOne({ _id: id });

        if (!recipe) {
          return res.status(404).json({ message: "Recipe not found" });
        }

        if (!req.body.userId || recipe.userId !== req.body.userId) {
          return res.status(403).json({ message: "Not authorized" });
        }

        await collection.deleteOne({ _id: id });
        res.status(200).json({ message: "Recipe deleted successfully" });
      } catch (error) {
        console.error("Delete recipe error:", error);
        res.status(400).json({
          message: "Failed to delete recipe",
          error: error.message,
        });
      }
    });

    app.post("/api/recipes/:id/like", async (req, res) => {
      const recipeId = req.params.id;
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({ message: "User ID is required" });
      }

      try {
        const recipe = await collection.findOne({
          _id: new ObjectId(recipeId),
        });

        if (!recipe) {
          return res.status(404).json({ message: "Recipe not found" });
        }

        if (recipe.userId === userId) {
          return res
            .status(403)
            .json({ message: "You can't like your own recipe" });
        }

        await collection.updateOne(
          { _id: new ObjectId(recipeId) },
          {
            $inc: { likes: 1 },
            $addToSet: { likedBy: userId },
          }
        );

        res.status(200).json({ message: "Liked successfully" });
      } catch (error) {
        console.error("Like recipe error:", error);
        res.status(500).json({
          message: "Failed to like recipe",
          error: error.message,
        });
      }
    });

    app.get("/api/auth/me", async (req, res) => {
      const { name, email, uid } = req.query;
      if (!email || !uid) {
        return res.status(400).json({ error: "email and uid are required" });
      }
      res.json({
        name: name || email.split("@")[0] || "User",
        email,
        uid,
      });
    });

    app.get("/api/recipes", async (req, res) => {
      try {
        const recipes = await collection.find().toArray();
        res.status(200).json(recipes);
      } catch (error) {
        console.error("Get all recipes error:", error);
        res.status(500).json({
          message: "Failed to fetch recipes",
          error: error.message,
        });
      }
    });

    // Error handling middleware
    app.use((err, req, res, next) => {
      console.error("Server error:", err);
      res.status(500).json({ message: "Internal server error" });
    });

    // 404 handler
    app.use((req, res) => {
      res.status(404).json({ message: "Route not found" });
    });

    // Start server
    const port = process.env.PORT || 5000;
    const server = app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });

    // Graceful shutdown
    process.on("SIGTERM", () => {
      console.log("SIGTERM received. Shutting down gracefully");
      server.close(() => {
        client.close().then(() => {
          console.log("Server and MongoDB connection closed");
          process.exit(0);
        });
      });
    });
  } catch (error) {
    console.error("Error connecting to MongoDB Atlas:", error);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

module.exports = app;
