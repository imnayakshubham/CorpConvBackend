const express = require("express");
const { getDemoData, updateDemoData } = require("../controllers/demoController");

const router = express.Router();

router.route("/").get(getDemoData).post(updateDemoData);

module.exports = router;
