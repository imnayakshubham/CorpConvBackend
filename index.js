require("dotenv").config();
const express = require("express");
const connectDB = require("./config/db");
const userRoutes = require("./routes/userRoutes");
const chatRoutes = require("./routes/chatRoutes");
const linkRoutes = require("./routes/linkRoutes");
const messageRoutes = require("./routes/messageRoutes");

const postRoutes = require("./routes/postRoutes");
const commentRoutes = require("./routes/commentRoutes");

const questionRoutes = require("./routes/questionRoutes");
const surveyRoutes = require("./routes/surveyRoutes");
const siteMapRoutes = require("./routes/siteMapRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const { toNodeHandler } = require("better-auth/node");
// auth is required later after DB connection


const cors = require("cors");

const { notFound, errorHandler } = require("./middleware/errorMiddleware");
const path = require("path");
const { initializeSocket, getIo } = require("./utils/socketManger");
const questionModel = require("./models/questionModel");
const questionAnswerModel = require("./models/questionAnswerModel");
const { default: mongoose } = require("mongoose");
const { job } = require("./restartServerCron");
const getRedisInstance = require("./redisClient/redisClient");
const cache = require("./redisClient/cacheHelper");
const TTL = require("./redisClient/cacheTTL");

// Helper function to fetch and update question cache
async function updateQuestionCache(questionId) {
  const cacheKey = cache.generateKey('question', questionId);
  const question = await questionModel.findById(questionId)
    .populate("question_posted_by", "public_user_name user_public_profile_pic avatar_config")
    .populate({
      path: "answers",
      match: { access: true },
      populate: {
        path: "answered_by",
        select: "public_user_name user_public_profile_pic avatar_config"
      }
    });
  if (question) {
    await cache.set(cacheKey, question.toObject(), TTL.QUESTION_DETAIL);
  }
  return question;
}

connectDB();
const { getAuth } = require("./utils/auth");
const app = express();

app.set('trust proxy', 1);


const allowedOrigins = (process.env.ALLOW_ORIGIN || "").split(",").map(o => o.trim()).filter(o => o.length > 0);


app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.some(o => {
      return (typeof o === "string" && o === origin) ||
        (o instanceof RegExp && o.test(origin));
    })) {
      callback(null, true);
    } else {
      console.warn(`Blocked by CORS: ${origin}`);
      callback(null, false);
    }
  },
  methods: ["GET", "POST", "DELETE", "PUT"],
  credentials: true,
  transports: ['websocket']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (process.env.APP_ENV === "PROD") {
  job.start()
}

app.get("/api/init", (req, res) => {
  try {
    res.status(200).json({
      status: "Success"
    });
  } catch (error) {
    console.error("Error handling /init request:", error);
    res.status(500).json({
      status: "Failed"
    });
  }
});

app.all("/api/auth/*", (req, res) => {
  return toNodeHandler(getAuth())(req, res);
});

app.use("/api", userRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/message", messageRoutes);
app.use("/api/link", linkRoutes);
app.use("/api/post", postRoutes);
app.use("/api/comment", commentRoutes);
app.use("/api/question", questionRoutes);
app.use("/api/survey", surveyRoutes);
app.use("/api/site_map", siteMapRoutes);
app.use("/api/upload", uploadRoutes);

// Serve uploaded files statically
app.use("/uploads", express.static(path.join(__dirname, "uploads")));


app.get("/", (req, res) => {
  res.send(`Hello World!`);
});


function generateRandomUserId() {
  return new mongoose.Types.ObjectId();
}

// Error Handling middlewares
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT;
const server = app.listen(
  PORT,
  console.log(`Server running on PORT ${PORT}...`.yellow.bold)
);
initializeSocket(server);


const redis = getRedisInstance();
if (redis) {
  redis.ping().then(() => {
    console.log('Redis ping successful');
  }).catch((err) => {
    console.warn('Redis ping failed, continuing without Redis cache features.');
  });
}

const io = getIo()

io.on("connection", (socket) => {
  let currentActiveChat = null
  console.log("Connected to socket.io");
  socket.on("setup", (userData) => {
    if (userData?._id) {
      socket.join(userData._id);
      socket.emit("connected");
    }
  });

  // Questions list room management
  socket.on("join_questions_list", () => {
    socket.join("questions_list");
  });

  socket.on("leave_questions_list", () => {
    socket.leave("questions_list");
  });

  // Question-specific room management
  socket.on("join_question_room", (question_id) => {
    if (question_id) {
      socket.join(question_id);
    }
  });

  socket.on("leave_question_room", (question_id) => {
    if (question_id) {
      socket.leave(question_id);
    }
  });

  socket.on("get_question", async (question_id) => {
    socket.join(question_id)
    let question = null
    try {
      question = await questionModel.findOne({ _id: question_id, access: true });
      question = await question.populate({
        path: 'answers',
        match: { access: true },
        populate: {
          path: 'answered_by',
          model: 'User',
          select: "public_user_name user_public_profile_pic"
        }
      });

      if (question) {
        question = {
          status: 'Success',
          data: question,
          message: "Question Fetched successfully"
        }
      } else {
        question = {
          status: 'Failed',
          message: "Question does not exist.",
          data: null
        }
      }
    } catch (error) {
      console.log(error)
      question = {
        data: null,
        status: 'Failed',
        message: "Failed to Fetch Question"
      }
    }

    socket.emit("send_question", question)
  })

  socket.on("delete_answer", async (payload) => {
    let updatedAnswer = null
    try {
      updatedAnswer = await questionAnswerModel.findByIdAndUpdate(payload.answer_id, { access: false }, { new: true })
      if (updatedAnswer) {
        // Update question cache with fresh data
        await updateQuestionCache(payload.question_id);

        updatedAnswer = {
          status: 'Success',
          data: updatedAnswer,
          message: "Answers Deleted successfully"
        }
      } else {
        updatedAnswer = {
          status: 'Failed',
          message: "Failed to Delete a Answers",
          data: null
        }
      }
    } catch (error) {
      updatedAnswer = {
        data: null,
        status: 'Failed',
        message: "Something went Wrong"
      }
    }
    io.to(payload.question_id).emit("delete_answer_response", updatedAnswer)
  });

  socket.on("current_chat", (chatId) => {
    currentActiveChat = chatId
  });

  socket.on("join chat", (room) => {
    socket.join(room);
    console.log("User Joined Room: " + room);
  });
  socket.on("typing", (room) => {
    socket.in(room).emit("typing")
  });

  // socket.on("read message", (chat) => {
  //   console.log({ chat })
  // })
  socket.on("stop typing", (room) => socket.in(room).emit("stop typing"));

  socket.on("send_follow_request", (payload) => {
    socket.in(payload.receiverId).emit("receive_follow_request", payload);
  })



  socket.on("new message", (newMessageRecieved) => {
    let chat = newMessageRecieved.chat;


    if (!chat.users) return console.log("chat.users not defined");

    chat.users.forEach((user) => {
      if (user._id == newMessageRecieved.sender._id) return;
      let readBy = [...newMessageRecieved.readBy]

      if (currentActiveChat === newMessageRecieved.chat._id) {
        if (!readBy.includes(user._id)) {
          readBy.push(user._id)
        }
      }

      socket.in(user._id).emit("message recieved", { ...newMessageRecieved, readBy });
    });
  });

  socket.on("send_answer_for_question", async (payload) => {
    if (payload.question_id) {
      let answer = null
      const answerData = {
        answered_by: payload.user_id,
        answer: payload.answer?.trim(),
        question_id: payload.question_id
      }

      try {
        let answerToAquestion = await questionAnswerModel.create(answerData);
        if (answerToAquestion) {
          if (!!answerToAquestion.answered_by) {
            const data = await answerToAquestion.populate({
              path: "answered_by",
              select: "public_user_name user_public_profile_pic"
            })
          } else {
            answerToAquestion = answerToAquestion.toObject();

            answerToAquestion = {
              ...answerToAquestion,
              answered_by: {
                public_user_name: "Anonymous User",
                user_public_profile_pic: "https://icon-library.com/images/anonymous-avatar-icon/anonymous-avatar-icon-25.jpg"
              }
            }
          }
          await questionModel.findByIdAndUpdate(payload.question_id, {
            $addToSet: { answers: answerToAquestion._id }
          });

          // Update question cache with fresh data
          await updateQuestionCache(payload.question_id);

          answer = {
            status: 'Success',
            data: answerToAquestion,
            message: "Question Saved successfully"
          }
        } else {
          answer = {
            status: 'Failed',
            message: "Failed to save the answer.",
            data: null
          }
        }
      } catch (error) {
        console.log({ error })
        answer = {
          data: null,
          status: 'Failed',
          message: "Something Went Wrong"
        }
      }
      io.to(payload.question_id).emit('get_answer_for_question', answer);

      // Broadcast answer count update to questions list
      if (answer.status === 'Success') {
        io.to("questions_list").emit("question_answer_count_updated", {
          question_id: payload.question_id
        });
      }
    }

  })

  socket.on("update_question_title", async (payload) => {
    let updatedQuestion = null
    try {
      updatedQuestion = await questionModel.findByIdAndUpdate(payload.question_id, { question: payload.question }, { new: true })

      if (updatedQuestion) {
        // Update question cache with fresh data
        await updateQuestionCache(payload.question_id);

        updatedQuestion = {
          status: 'Success',
          data: updatedQuestion,
          message: "Question Updated successfully"
        }
      } else {
        updatedQuestion = {
          status: 'Failed',
          message: "Failed to Updated a Question",
          data: null
        }
      }
    } catch (error) {
      console.log(error)
      updatedQuestion = {
        data: null,
        status: 'Failed',
        message: "Something went Wrong"
      }
    }
    io.to(payload.question_id).emit("update_title_response", updatedQuestion)
  });


  socket.on("update_question_likes", async (payload) => {
    let updatedQuestion = null
    try {
      const question = await questionModel.findById(payload.question_id);
      if (!question) {
        updatedQuestion = {
          status: 'Failed',
          data: null,
          message: "Question Like Update Failed"
        }
      }
      const userId = payload.user_id ?? generateRandomUserId()

      // Check if user has already liked the answer
      const userIndex = question.liked_by.indexOf(userId);
      if (userIndex === -1) {
        // User hasn't liked the question, add like
        question.liked_by.push(userId);
      } else {
        // User has already liked the question, remove like
        question.liked_by.splice(userIndex, 1);
      }

      // Save the updated question
      updatedQuestion = await question.save();

      // Update question cache with fresh data
      await updateQuestionCache(payload.question_id);

      updatedQuestion = {
        status: 'Success',
        data: updatedQuestion,
        message: "Question Like Updated successfully"
      }

    } catch (error) {
      console.error("Error liking/unliking answer:", error);
      updatedQuestion = {
        status: 'Failed',
        data: null,
        message: "Error liking/unliking answer"
      }
    }
    io.to(payload.question_id).emit("update_likes_response", updatedQuestion)

    // Broadcast like count update to questions list
    if (updatedQuestion.status === 'Success') {
      io.to("questions_list").emit("question_likes_updated", {
        question_id: payload.question_id,
        liked_by: updatedQuestion.data.liked_by
      });
    }

  })

  // Delete question via socket
  socket.on("delete_question", async (payload) => {
    try {
      const updated = await questionModel.findByIdAndUpdate(
        payload.question_id,
        { access: false },
        { new: true }
      );
      if (updated) {
        // Invalidate question cache
        const cacheKey = cache.generateKey('question', payload.question_id);
        await cache.del(cacheKey);

        io.to("questions_list").emit("question_deleted", {
          question_id: payload.question_id
        });
        socket.emit("delete_question_response", {
          status: 'Success',
          message: "Question deleted successfully"
        });
      } else {
        socket.emit("delete_question_response", {
          status: 'Failed',
          message: "Question not found"
        });
      }
    } catch (error) {
      console.error("Error deleting question:", error);
      socket.emit("delete_question_response", {
        status: 'Failed',
        message: "Failed to delete question"
      });
    }
  });

  socket.off("setup", () => {
    console.log("USER DISCONNECTED");
    socket.leave(userData._id);
  });
});
