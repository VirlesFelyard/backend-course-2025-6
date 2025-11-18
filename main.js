const { Command } = require("commander");
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs").promises;
const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");

const program = new Command();
const app = express();

program
  .requiredOption("-h, --host <host>", "server address")
  .requiredOption("-p, --port <port>", "server port")
  .requiredOption("-c, --cache <cache>", "path to cache directory")
  .parse(process.argv);

const options = program.opts();

const DATA_FILE = path.join(__dirname, "inventory.json");

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Inventory Service API",
      version: "1.0.0",
      description: "A simple inventory management system API",
    },
    servers: [
      {
        url: `http://${options.host}:${options.port}`,
        description: "Development server",
      },
    ],
  },
  apis: ["./*.js"],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

async function readInventory() {
  try {
    await fs.access(DATA_FILE);
    const data = await fs.readFile(DATA_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

async function getNextId() {
  const inventory = await readInventory();
  if (inventory.length === 0) return 1;
  return Math.max(...inventory.map((item) => item.id)) + 1;
}

async function writeInventory(data) {
  try {
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    return false;
  }
}

async function createDirectories() {
  try {
    await fs.access(options.cache);
  } catch {
    await fs.mkdir(options.cache, { recursive: true });
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, options.cache);
  },
  filename: (req, file, cb) => {
    const uniqueName =
      Date.now() +
      "-" +
      Math.round(Math.random() * 1e9) +
      path.extname(file.originalname);
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only images are allowed"), false);
    }
  },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large. Maximum 5MB" });
    }
  }
  next(error);
});

/**
 * @swagger
 * /RegisterForm.html:
 *   get:
 *     summary: Get registration form HTML page
 *     description: Returns the HTML form for registering new inventory items
 *     responses:
 *       200:
 *         description: HTML form page
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 */
app.get("/RegisterForm.html", (req, res) => {
  res.sendFile(path.join(__dirname, "RegisterForm.html"));
});

/**
 * @swagger
 * /SearchForm.html:
 *   get:
 *     summary: Get search form HTML page
 *     description: Returns the HTML form for searching inventory items
 *     responses:
 *       200:
 *         description: HTML form page
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 */
app.get("/SearchForm.html", (req, res) => {
  res.sendFile(path.join(__dirname, "SearchForm.html"));
});

/**
 * @swagger
 * /register:
 *   post:
 *     summary: Register a new inventory item
 *     description: Register a new device with name, description, and optional photo
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - inventory_name
 *             properties:
 *               inventory_name:
 *                 type: string
 *                 description: Name of the inventory item (required)
 *               description:
 *                 type: string
 *                 description: Description of the inventory item
 *               photo:
 *                 type: string
 *                 format: binary
 *                 description: Photo image file
 *     responses:
 *       201:
 *         description: Device registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 inventory:
 *                   type: object
 *       400:
 *         description: Bad Request - Name is required
 *       500:
 *         description: Internal Server Error - Data save error
 */
app.post("/register", upload.single("photo"), async (req, res) => {
  const { inventory_name, description } = req.body;

  if (!inventory_name) {
    return res.status(400).json({ error: "Name is required" });
  }

  const inventory = await readInventory();
  const newItem = {
    id: await getNextId(),
    inventory_name,
    description: description || "",
    photo_filename: req.file ? req.file.filename : null,
  };

  inventory.push(newItem);

  if (!(await writeInventory(inventory))) {
    return res.status(500).json({ error: "Data save error" });
  }

  res.status(201).json({
    message: "Device registered successfully",
    inventory: newItem,
  });
});

/**
 * @swagger
 * /inventory:
 *   get:
 *     summary: Get all inventory items
 *     description: Returns a list of all registered inventory items with photo URLs
 *     responses:
 *       200:
 *         description: List of inventory items
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   inventory_name:
 *                     type: string
 *                   description:
 *                     type: string
 *                   photo_filename:
 *                     type: string
 *                   photo_url:
 *                     type: string
 */
app.get("/inventory", async (req, res) => {
  const inventory = await readInventory();

  const inventoryWithPhotoUrls = inventory.map((item) => ({
    ...item,
    photo_url: item.photo_filename ? `/inventory/${item.id}/photo` : null,
  }));

  res.json(inventoryWithPhotoUrls);
});

/**
 * @swagger
 * /inventory/{id}:
 *   get:
 *     summary: Get specific inventory item by ID
 *     description: Returns detailed information about a specific inventory item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Inventory item ID
 *     responses:
 *       200:
 *         description: Inventory item details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 inventory_name:
 *                   type: string
 *                 description:
 *                   type: string
 *                 photo_filename:
 *                   type: string
 *                 photo_url:
 *                   type: string
 *       404:
 *         description: Device not found
 */
app.get("/inventory/:id", async (req, res) => {
  const { id } = req.params;
  const inventory = await readInventory();
  const item = inventory.find((item) => item.id === parseInt(id));

  if (!item) {
    return res.status(404).json({ error: "Device not found" });
  }

  item.photo_url = item.photo_filename ? `/inventory/${item.id}/photo` : null;

  res.json(item);
});

/**
 * @swagger
 * /inventory/{id}:
 *   put:
 *     summary: Update inventory item name or description
 *     description: Update the name and/or description of an existing inventory item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Inventory item ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               inventory_name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Device updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 inventory:
 *                   type: object
 *       404:
 *         description: Device not found
 *       500:
 *         description: Internal Server Error - Data save error
 */
app.put("/inventory/:id", async (req, res) => {
  const { id } = req.params;
  const { inventory_name, description } = req.body;

  const inventory = await readInventory();
  const itemIndex = inventory.findIndex((item) => item.id === parseInt(id));

  if (itemIndex === -1) {
    return res.status(404).json({ error: "Device not found" });
  }

  if (inventory_name !== undefined) {
    inventory[itemIndex].inventory_name = inventory_name;
  }
  if (description !== undefined) {
    inventory[itemIndex].description = description;
  }

  if (!(await writeInventory(inventory))) {
    return res.status(500).json({ error: "Data save error" });
  }

  res.json({
    message: "Device updated successfully",
    inventory: inventory[itemIndex],
  });
});

/**
 * @swagger
 * /inventory/{id}/photo:
 *   get:
 *     summary: Get inventory item photo
 *     description: Returns the photo image for a specific inventory item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Inventory item ID
 *     responses:
 *       200:
 *         description: Photo image
 *         content:
 *           image/jpeg:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Photo not found
 */
app.get("/inventory/:id/photo", async (req, res) => {
  const { id } = req.params;
  const inventory = await readInventory();
  const item = inventory.find((item) => item.id === parseInt(id));

  if (!item || !item.photo_filename) {
    return res.status(404).json({ error: "Photo not found" });
  }

  const photoPath = path.join(options.cache, item.photo_filename);

  try {
    await fs.access(photoPath);
    res.setHeader("Content-Type", "image/jpeg");
    res.sendFile(photoPath);
  } catch {
    return res.status(404).json({ error: "Photo file not found" });
  }
});

/**
 * @swagger
 * /inventory/{id}/photo:
 *   put:
 *     summary: Update inventory item photo
 *     description: Update the photo for a specific inventory item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Inventory item ID
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *                 description: New photo image file
 *     responses:
 *       200:
 *         description: Photo updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 inventory:
 *                   type: object
 *       400:
 *         description: No photo provided
 *       404:
 *         description: Device not found
 *       500:
 *         description: Internal Server Error - Data save error
 */
app.put("/inventory/:id/photo", upload.single("photo"), async (req, res) => {
  const { id } = req.params;

  if (!req.file) {
    return res.status(400).json({ error: "No photo provided" });
  }

  const inventory = await readInventory();
  const itemIndex = inventory.findIndex((item) => item.id === parseInt(id));

  if (itemIndex === -1) {
    return res.status(404).json({ error: "Device not found" });
  }

  const oldPhoto = inventory[itemIndex].photo_filename;
  if (oldPhoto) {
    const oldPhotoPath = path.join(options.cache, oldPhoto);
    try {
      await fs.access(oldPhotoPath);
      await fs.unlink(oldPhotoPath);
    } catch {}
  }

  inventory[itemIndex].photo_filename = req.file.filename;

  if (!(await writeInventory(inventory))) {
    return res.status(500).json({ error: "Data save error" });
  }

  res.json({
    message: "Photo updated successfully",
    inventory: inventory[itemIndex],
  });
});

/**
 * @swagger
 * /inventory/{id}:
 *   delete:
 *     summary: Delete inventory item
 *     description: Delete a specific inventory item and its associated photo
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Inventory item ID
 *     responses:
 *       200:
 *         description: Device deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 inventory:
 *                   type: object
 *       404:
 *         description: Device not found
 *       500:
 *         description: Internal Server Error - Data save error
 */
app.delete("/inventory/:id", async (req, res) => {
  const { id } = req.params;
  const inventory = await readInventory();
  const itemIndex = inventory.findIndex((item) => item.id === parseInt(id));

  if (itemIndex === -1) {
    return res.status(404).json({ error: "Device not found" });
  }

  const deletedItem = inventory[itemIndex];

  if (deletedItem.photo_filename) {
    const photoPath = path.join(options.cache, deletedItem.photo_filename);
    try {
      await fs.access(photoPath);
      await fs.unlink(photoPath);
    } catch {}
  }

  inventory.splice(itemIndex, 1);

  if (!(await writeInventory(inventory))) {
    return res.status(500).json({ error: "Data save error" });
  }

  res.json({
    message: "Device deleted successfully",
    inventory: deletedItem,
  });
});

/**
 * @swagger
 * /search:
 *   post:
 *     summary: Search for inventory item by ID
 *     description: Search for an inventory item by ID with optional photo URL in description
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required:
 *               - id
 *             properties:
 *               id:
 *                 type: integer
 *                 description: Inventory item ID to search for
 *               has_photo:
 *                 type: string
 *                 description: If "true", adds photo URL to description
 *     responses:
 *       200:
 *         description: Found inventory item
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: ID is required
 *       404:
 *         description: Device not found
 */
app.post("/search", async (req, res) => {
  const { id, has_photo } = req.body;

  if (!id) {
    return res.status(400).json({ error: "ID is required" });
  }

  const inventory = await readInventory();
  const item = inventory.find((item) => item.id === parseInt(id));

  if (!item) {
    return res.status(404).json({ error: "Device not found" });
  }

  const result = { ...item };

  if (has_photo === "true" && item.photo_filename) {
    result.description =
      result.description + `\n[Photo: /inventory/${item.id}/photo]`;
  }

  result.photo_url = item.photo_filename ? `/inventory/${item.id}/photo` : null;

  res.json(result);
});

app.use((req, res) => {
  res.status(405).json({ error: "Method Not Allowed" });
});

async function startServer() {
  await createDirectories();
  await readInventory();

  app.listen(options.port, options.host, () => {
    console.log(`Server running at http://${options.host}:${options.port}`);
    console.log(
      `Swagger documentation available at http://${options.host}:${options.port}/docs`,
    );
  });
}

startServer();
