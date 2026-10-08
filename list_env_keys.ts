console.log("=== ENVIRONMENT VARIABLE KEYS ===");
Object.keys(process.env).sort().forEach(key => {
  const valueExists = process.env[key] !== undefined && process.env[key] !== "";
  const length = process.env[key] ? process.env[key]!.length : 0;
  console.log(`Key: ${key} | Has Value: ${valueExists} | Length: ${length}`);
});
