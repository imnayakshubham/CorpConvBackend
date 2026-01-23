const jwt = require("jsonwebtoken");
const { default: mongoose } = require("mongoose");
const { jobPostSites, verifiedLinkSources } = require("../constants");

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET_KEY, {
        expiresIn: "30d",
    });
};

const toTitleCase = (userInput) => {
    return userInput.replace(/\b\w/g, match => match.toUpperCase());
}

const randomIdGenerator = (size = 15, chars = '0123456789ABCDEF') => {
    let result = '';
    for (let i = 0; i < size; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result
}

const generateUserId = (userType = "user_") => {
    const date = new Date();
    const year = date.getFullYear().toString();
    const size = 24 - `${userType.trim()}${year}`.length;

    const randomId = randomIdGenerator(size);
    const newId = randomId.padEnd(size, '0');

    const userId = `${userType.toLowerCase()}${newId}${year}`;
    return userId;
};

const keepOnlyNumbers = (inputString) => {
    return Number(inputString.replace(/[^0-9]/g, ''))
}

const isJobVerified = (link) => {
    return jobPostSites.some(keyword => link.includes(keyword));
}

const isVerifiedSource = (link) => {
    return verifiedLinkSources.some(keyword => link.toLowerCase().includes(keyword.toLowerCase()));
}

const populateChildComments = async (comments) => {
    for (const comment of comments) {
        await comment.populate('commented_by', "public_user_name is_email_verified avatar_config")

        if (comment.nested_comments.length > 0) {
            if (comment.access || comment?.access === undefined) {
                await comment.populate('commented_by', "public_user_name is_email_verified avatar_config")
                await comment.populate({
                    path: 'nested_comments',
                    match: { access: { $ne: false } },
                });
                await populateChildComments(comment.nested_comments)
            }
        }
    }
};

module.exports = { generateToken, toTitleCase, randomIdGenerator, generateUserId, keepOnlyNumbers, isJobVerified, isVerifiedSource, populateChildComments };