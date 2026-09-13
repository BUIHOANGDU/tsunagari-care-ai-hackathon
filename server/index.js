const express = require("express");
const cors = require("cors");
require("dotenv").config();

const healthRouter = require("./routes/health");
const debugRouter = require("./routes/debug");
const chamiRouter = require("./routes/chami");
const familyRouter = require("./routes/family");
const smartHomeRouter = require("./routes/smartHome");
const robotRouter = require("./routes/robot");
const weatherRouter = require("./routes/weather");
const {
  startMedicineReminderScheduler,
} = require("./lib/medicineReminderScheduler");

const app = express();
const port = process.env.PORT || 3001;
const trustProxyHops = getTrustProxyHops();

function getTrustProxyHops() {
  const raw = process.env.TRUST_PROXY_HOPS;

  if (raw === undefined || raw === null || raw === "") {
    return process.env.RENDER ? 1 : 0;
  }

  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }

  console.warn("Invalid TRUST_PROXY_HOPS; using direct client IP mode.");
  return 0;
}

if (trustProxyHops > 0) {
  app.set("trust proxy", trustProxyHops);
}

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "tsunagari-care-server",
    time: new Date().toISOString(),
  });
});

app.use("/api/health", healthRouter);
app.use("/api/debug", debugRouter);
app.use("/api/chami", chamiRouter);
app.use("/api/family", familyRouter);
app.use("/api/smart-home", smartHomeRouter);
app.use("/api/robot", robotRouter);
app.use("/api/weather", weatherRouter);

app.listen(port, () => {
  console.log(`Tsunagari Bridge API running on port ${port}`);
  startMedicineReminderScheduler();
});
