const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = mongoose.Schema({
  actual_user_name: {
    type: String,
    default: null,
    required: [true, "User Name is required"],
  },
  public_user_name: {
    type: String,
    default: null
  },
  is_email_verified: {
    type: Boolean,
    default: false,
    required: [true, "is_email_verified is required"],
  },
  user_location: {
    type: String,
    default: null
  },
  user_job_role: {
    type: String,
    default: null
  },
  user_job_experience: {
    type: Number,
    default: null
  },
  user_bio: {
    type: String,
    default: null
  },
  isAdmin: {
    type: Boolean,
    required: true,
    default: false,
  },
  actual_profile_pic: {
    type: String,
    required: false,
    default: "https://icon-library.com/images/anonymous-avatar-icon/anonymous-avatar-icon-25.jpg",
  },
  user_public_profile_pic: {
    type: String,
    required: true,
    default: "https://icon-library.com/images/anonymous-avatar-icon/anonymous-avatar-icon-25.jpg",
  },
  provider: {
    type: String,
    required: true,
  },
  providerId: {
    type: String,
    required: true,
  },
  user_phone_number: {
    type: Number,
    required: true,
    default: null
  },
  is_anonymous: {
    type: Boolean,
    default: false,
  },
  user_email_id: {
    type: String,
    trim: true,
    unique: true,
    required: [true, "Email is required"],
  },
  is_email_verified: {
    type: Boolean,
    default: false,
    required: [true, "Email Verfication key is required"],
  },
  access: { type: Boolean, required: true, default: true },
  meta_data: {
    type: Object,
    default: {}
  },
  user_current_company_name: {
    type: String,
    trim: true,
    required: [true, "User Company Name is required"],
  },
  user_company_id: {
    type: String,
    trim: true,
    required: [true, "User Company Id is required"],
  },
  user_past_company_history: {
    type: Object,
    default: []
  },
  token: {
    default: null,
    type: String,
  },
  followers: [{
    type: String,
    ref: 'User',
    default: [],
  }],
  followings: [{
    type: String,
    ref: 'User',
    default: [],
  }],
  pending_followings: [{
    type: String,
    ref: 'User',
    default: []
  }],
}, { timestaps: true });

const User = mongoose.model("User", userSchema);

module.exports = User;
