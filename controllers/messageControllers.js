const asyncHandler = require("express-async-handler");
const Message = require("../models/messageModel");
const { User } = require("../models/userModel");
const Chat = require("../models/chatModel");

const allMessages = asyncHandler(async (req, res) => {
  try {

    const updateResult = await Message.updateMany(
      { chat: req.params.chatId, readBy: { $nin: [req.user._id] } },
      { $addToSet: { readBy: req.user._id } }
    );

    const messages = await Message.find({ chat: req.params.chatId }).populate("sender", "public_user_name user_job_experience user_current_company_name").populate("chat");

    const updateChatData = await Chat.findByIdAndUpdate({ _id: req.params.chatId }, { unreadMessage: [] }, {
      new: true,
    }).populate({
      path: "users",
      select: "public_user_name user_job_experience user_current_company_name"
    })
      .populate("groupAdmin")
      .populate("latestMessage")

    await User.populate(updateChatData, {
      path: "latestMessage.sender",
      select: "public_user_name user_job_experience user_current_company_name",
    });

    res.status(200).send({ status: "Success", message: "chats found for the user.", result: { messages, chatData: updateChatData } });
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

//@description     Create New Message
//@route           POST /api/Message/
//@access          Protected
const sendMessage = asyncHandler(async (req, res) => {
  const { content, chatId } = req.body;
  if (!content || !chatId) {
    console.log("Invalid data passed into request");
    return res.sendStatus(400);
  }

  var newMessage = {
    sender: req.user._id,
    content: content,
    chat: chatId,
    readBy: [req.user._id]
  };

  try {
    var message = await Message.create(newMessage);
    message = await message.populate("sender", "public_user_name user_job_experience user_current_company_name")
    message = await message.populate("chat")
    message = await User.populate(message, {
      path: "chat.users",
      select: "public_user_name user_job_experience user_current_company_name",
    });

    await Chat.findByIdAndUpdate(req.body.chatId, { latestMessage: message });

    await Chat.findByIdAndUpdate(
      req.body.chatId,
      {
        $addToSet: {
          unreadMessage: {
            messageId: message._id,
            readBy: [req.user._id],
          },
        },
      },
      { new: true }
    );

    res.json(message);
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

module.exports = { allMessages, sendMessage };
