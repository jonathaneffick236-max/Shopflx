const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 10000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});


// ===============================
// DATABASE
// ===============================

async function initDatabase() {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'customer',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      seller_id INTEGER,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      price NUMERIC(12,2) NOT NULL,
      old_price NUMERIC(12,2),
      image_url TEXT,
      stock INTEGER DEFAULT 0,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      region TEXT,
      address TEXT NOT NULL,
      total NUMERIC(12,2) NOT NULL,
      payment_method TEXT,
      payment_reference TEXT,
      payment_status TEXT DEFAULT 'pending',
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      price NUMERIC(12,2) NOT NULL
    );
  `);

  console.log("Database ready");
}


// ===============================
// HEALTH
// ===============================

app.get("/", (req, res) => {

  res.json({
    status: "online",
    app: "SHOPFLIX",
    message: "SHOPFLIX backend is running"
  });

});


app.get("/api/health", async (req, res) => {

  try {

    await pool.query("SELECT 1");

    res.json({
      status: "ok",
      database: "connected"
    });

  } catch (error) {

    res.status(500).json({
      status: "error",
      database: "disconnected"
    });

  }

});


// ===============================
// PRODUCTS
// ===============================

app.get("/api/products", async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT *
      FROM products
      WHERE active = TRUE
      ORDER BY created_at DESC
    `);

    res.json(result.rows);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not load products"
    });

  }

});


app.get("/api/products/:id", async (req, res) => {

  try {

    const result = await pool.query(
      `
      SELECT *
      FROM products
      WHERE id = $1
      `,
      [req.params.id]
    );

    if (result.rows.length === 0) {

      return res.status(404).json({
        error: "Product not found"
      });

    }

    res.json(result.rows[0]);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not load product"
    });

  }

});


// ===============================
// ADD PRODUCT
// ===============================

app.post("/api/products", async (req, res) => {

  try {

    const {
      seller_id,
      name,
      description,
      category,
      price,
      old_price,
      image_url,
      stock
    } = req.body;

    if (!name || price === undefined) {

      return res.status(400).json({
        error: "Product name and price are required"
      });

    }

    const result = await pool.query(
      `
      INSERT INTO products
      (
        seller_id,
        name,
        description,
        category,
        price,
        old_price,
        image_url,
        stock
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
      `,
      [
        seller_id || null,
        name,
        description || "",
        category || "Other",
        price,
        old_price || null,
        image_url || "",
        stock || 0
      ]
    );

    res.status(201).json(result.rows[0]);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not create product"
    });

  }

});


// ===============================
// REGISTER
// ===============================

app.post("/api/auth/register", async (req, res) => {

  try {

    const {
      name,
      email,
      phone,
      password
    } = req.body;

    if (!name || !email || !password) {

      return res.status(400).json({
        error: "Name, email and password are required"
      });

    }

    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (existing.rows.length) {

      return res.status(409).json({
        error: "Account already exists"
      });

    }

    const hashedPassword =
      await bcrypt.hash(password, 10);

    const result = await pool.query(
      `
      INSERT INTO users
      (name,email,phone,password)
      VALUES ($1,$2,$3,$4)
      RETURNING id,name,email,phone,role,created_at
      `,
      [
        name,
        email.toLowerCase(),
        phone || null,
        hashedPassword
      ]
    );

    res.status(201).json({
      message: "Account created",
      user: result.rows[0]
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Registration failed"
    });

  }

});


// ===============================
// LOGIN
// ===============================

app.post("/api/auth/login", async (req, res) => {

  try {

    const {
      email,
      password
    } = req.body;

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {

      return res.status(401).json({
        error: "Invalid email or password"
      });

    }

    const user = result.rows[0];

    const valid =
      await bcrypt.compare(
        password,
        user.password
      );

    if (!valid) {

      return res.status(401).json({
        error: "Invalid email or password"
      });

    }

    delete user.password;

    res.json({
      message: "Login successful",
      user
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Login failed"
    });

  }

});


// ===============================
// CREATE ORDER
// ===============================

app.post("/api/orders", async (req, res) => {

  const client = await pool.connect();

  try {

    const {
      user_id,
      customer_name,
      customer_phone,
      region,
      address,
      payment_method,
      items
    } = req.body;

    if (
      !customer_name ||
      !customer_phone ||
      !address ||
      !Array.isArray(items) ||
      items.length === 0
    ) {

      return res.status(400).json({
        error: "Incomplete order"
      });

    }

    await client.query("BEGIN");

    let total = 0;
    const orderItems = [];

    for (const item of items) {

      const productResult =
        await client.query(
          `
          SELECT *
          FROM products
          WHERE id = $1
          AND active = TRUE
          `,
          [item.product_id]
        );

      if (productResult.rows.length === 0) {

        throw new Error(
          `Product ${item.product_id} not found`
        );

      }

      const product =
        productResult.rows[0];

      const quantity =
        Number(item.quantity) || 1;

      if (product.stock < quantity) {

        throw new Error(
          `${product.name} is out of stock`
        );

      }

      total +=
        Number(product.price) * quantity;

      orderItems.push({
        product_id: product.id,
        quantity,
        price: product.price
      });

    }


    const orderResult =
      await client.query(
        `
        INSERT INTO orders
        (
          user_id,
          customer_name,
          customer_phone,
          region,
          address,
          total,
          payment_method
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING *
        `,
        [
          user_id || null,
          customer_name,
          customer_phone,
          region || "",
          address,
          total,
          payment_method || "Mobile Money"
        ]
      );


    const order =
      orderResult.rows[0];


    for (const item of orderItems) {

      await client.query(
        `
        INSERT INTO order_items
        (
          order_id,
          product_id,
          quantity,
          price
        )
        VALUES ($1,$2,$3,$4)
        `,
        [
          order.id,
          item.product_id,
          item.quantity,
          item.price
        ]
      );


      await client.query(
        `
        UPDATE products
        SET stock = stock - $1
        WHERE id = $2
        `,
        [
          item.quantity,
          item.product_id
        ]
      );

    }


    await client.query("COMMIT");


    res.status(201).json({
      message: "Order created",
      order
    });


  } catch (error) {

    await client.query("ROLLBACK");

    console.error(error);

    res.status(400).json({
      error: error.message
    });

  } finally {

    client.release();

  }

});


// ===============================
// GET ORDER
// ===============================

app.get("/api/orders/:id", async (req, res) => {

  try {

    const orderResult =
      await pool.query(
        `
        SELECT *
        FROM orders
        WHERE id = $1
        `,
        [req.params.id]
      );

    if (orderResult.rows.length === 0) {

      return res.status(404).json({
        error: "Order not found"
      });

    }

    const itemsResult =
      await pool.query(
        `
        SELECT
          oi.*,
          p.name,
          p.image_url
        FROM order_items oi
        JOIN products p
        ON p.id = oi.product_id
        WHERE oi.order_id = $1
        `,
        [req.params.id]
      );

    res.json({
      order: orderResult.rows[0],
      items: itemsResult.rows
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not load order"
    });

  }

});


// ===============================
// UPDATE ORDER STATUS
// ===============================

app.patch("/api/orders/:id/status", async (req, res) => {

  try {

    const {
      status
    } = req.body;

    const allowed = [
      "pending",
      "paid",
      "processing",
      "shipped",
      "delivered",
      "cancelled"
    ];

    if (!allowed.includes(status)) {

      return res.status(400).json({
        error: "Invalid order status"
      });

    }

    const result =
      await pool.query(
        `
        UPDATE orders
        SET status = $1
        WHERE id = $2
        RETURNING *
        `,
        [
          status,
          req.params.id
        ]
      );

    if (result.rows.length === 0) {

      return res.status(404).json({
        error: "Order not found"
      });

    }

    res.json(result.rows[0]);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Could not update order"
    });

  }

});


// ===============================
// START SERVER
// ===============================

initDatabase()
  .then(() => {

    app.listen(PORT, () => {

      console.log(
        `SHOPFLIX server running on port ${PORT}`
      );

    });

  })
  .catch(error => {

    console.error(
      "Database initialization failed:",
      error
    );

    process.exit(1);

  });
