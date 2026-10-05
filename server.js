initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `SHOPFLIX server running on port ${PORT}`
      );
    });
  })
  .catch((error) => {
    console.error(
      "Database initialization failed:",
      error
    );

    process.exit(1);
  });
