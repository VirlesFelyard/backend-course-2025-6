const { Command } = require("commander");
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs").promises;

const program = new Command();
const app = express();

program
  .requiredOption("-h, --host <host>", "server address")
  .requiredOption("-p, --port <port>", "server port")
  .requiredOption("-c, --cache <cache>", "path to cache directory")
  .parse(process.argv);

const options = program.opts();

const DATA_FILE = path.join(__dirname, "inventory.json");

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

  try {
    await fs.access("photos");
  } catch {
    await fs.mkdir("photos", { recursive: true });
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "photos/");
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
app.use(express.static("."));

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large. Maximum 5MB" });
    }
  }
  next(error);
});

app.get("/RegisterForm.html", (req, res) => {
  res.sendFile(path.join(__dirname, "RegisterForm.html"));
});

app.get("/SearchForm.html", (req, res) => {
  res.sendFile(path.join(__dirname, "SearchForm.html"));
});

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
    created_at: new Date().toISOString(),
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

app.get("/inventory", async (req, res) => {
  const inventory = await readInventory();

  const inventoryWithPhotoUrls = inventory.map((item) => ({
    ...item,
    photo_url: item.photo_filename ? `/inventory/${item.id}/photo` : null,
  }));

  res.json(inventoryWithPhotoUrls);
});

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

app.get("/inventory/:id/photo", async (req, res) => {
  const { id } = req.params;
  const inventory = await readInventory();
  const item = inventory.find((item) => item.id === parseInt(id));

  if (!item || !item.photo_filename) {
    return res.status(404).json({ error: "Photo not found" });
  }

  const photoPath = path.join(__dirname, "photos", item.photo_filename);

  try {
    await fs.access(photoPath);
    res.setHeader("Content-Type", "image/jpeg");
    res.sendFile(photoPath);
  } catch {
    return res.status(404).json({ error: "Photo file not found" });
  }
});

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
    const oldPhotoPath = path.join(__dirname, "photos", oldPhoto);
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

app.delete("/inventory/:id", async (req, res) => {
  const { id } = req.params;
  const inventory = await readInventory();
  const itemIndex = inventory.findIndex((item) => item.id === parseInt(id));

  if (itemIndex === -1) {
    return res.status(404).json({ error: "Device not found" });
  }

  const deletedItem = inventory[itemIndex];

  if (deletedItem.photo_filename) {
    const photoPath = path.join(
      __dirname,
      "photos",
      deletedItem.photo_filename,
    );
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
  });
}

startServer();
