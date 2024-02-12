const mongoose = require("mongoose");

const CompanySchema = mongoose.Schema({
    company_id: {
        type: mongoose.Schema.Types.ObjectId,
        trim: true,
        unique: true,
        required: [true, "Company Id is required"],
    },
    company_name: {
        type: String,
        trim: true,
        unique: true,
        required: [true, "Company Name is required"],
    }
}, { timestamps: true });

const Company = mongoose.model("Company", CompanySchema);

module.exports = Company;