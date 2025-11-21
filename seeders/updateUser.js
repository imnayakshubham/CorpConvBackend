const { User } = require("../models/userModel");
const mongoose = require("mongoose");


async function addKeysToUserCollection() {
    try {
        const users = await User.find({}, { user_email_id: 1, _id: 0 });

        const updatePromises = users.map(async (user) => {
            const primaryEmailDomain = user.user_email_id.split('@')[1];

            // Update the document based on user_email_id
            const updatedUser = await User.findOneAndUpdate(
                { user_email_id: user.user_email_id },
                {
                    $set: {
                        secondary_email_domain: null,
                        primary_email_domain: primaryEmailDomain
                    }
                },
                { new: true } // Return the updated document
            );

            console.log('Updated User:', updatedUser);
            return updatedUser;
        });

        // Wait for all update operations to complete
        const updatedUsers = await Promise.all(updatePromises);
        console.log('All users updated successfully:', updatedUsers);


    } catch (error) {
    } finally {
        mongoose.disconnect()
    }
}

addKeysToUserCollection()