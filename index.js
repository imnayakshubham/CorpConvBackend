require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const connectDB = require("./config/db");
const { globalLimiter } = require("./middleware/rateLimiter");
const { stripAllHtml } = require("./utils/sanitize");
const userRoutes = require("./routes/userRoutes");
const chatRoutes = require("./routes/chatRoutes");
const linkRoutes = require("./routes/linkRoutes");
const messageRoutes = require("./routes/messageRoutes");

const postRoutes = require("./routes/postRoutes");
const commentRoutes = require("./routes/commentRoutes");

const questionRoutes = require("./routes/questionRoutes");
const surveyRoutes = require("./routes/surveyRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const siteMapRoutes = require("./routes/siteMapRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const adminRoutes = require("./routes/adminRoutes");
const usernameRoutes = require("./routes/usernameRoutes");
const bentoRoutes = require("./routes/bentoRoutes");
const blockRoutes = require("./routes/blockRoutes");
const { trackActivity } = require("./middleware/activityMiddleware");
// Dynamic import for ESM-only better-auth/node
let _toNodeHandler;
const getToNodeHandler = async () => {
  if (!_toNodeHandler) {
    const mod = await import("better-auth/node");
    _toNodeHandler = mod.toNodeHandler;
  }
  return _toNodeHandler;
};


const cors = require("cors");

const { notFound, errorHandler } = require("./middleware/errorMiddleware");
const path = require("path");
const { initializeSocket, getIo } = require("./utils/socketManger");
const notificationService = require("./utils/notificationService");
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

// Helper function to invalidate questions list cache
async function invalidateQuestionsListCache() {
  await cache.delByPattern(`${process.env.APP_ENV || 'DEV'}:questions:list:*`);
}

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
  methods: ["GET", "POST", "DELETE", "PUT", "PATCH"],
  credentials: true,
  transports: ['websocket']
}));

app.use(helmet({
  // API-only server: no HTML served, so CSP would have no effect and could
  // interfere with the Better Auth handler. Disable it explicitly.
  contentSecurityPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true },
  referrerPolicy: { policy: 'no-referrer' },
  // noSniff, frameguard, xssFilter remain on (helmet defaults).
}));
app.use(globalLimiter);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

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

app.all("/api/auth/*", async (req, res) => {
  const toNodeHandler = await getToNodeHandler();
  const auth = await getAuth();
  return toNodeHandler(auth)(req, res);
});

app.use("/api", userRoutes);
app.use("/api/chat", trackActivity, chatRoutes);
app.use("/api/message", trackActivity, messageRoutes);
app.use("/api/link", trackActivity, linkRoutes);
app.use("/api/post", trackActivity, postRoutes);
app.use("/api/comment", trackActivity, commentRoutes);
app.use("/api/question", trackActivity, questionRoutes);
app.use("/api/survey", trackActivity, surveyRoutes);
app.use("/api/notification", notificationRoutes);
app.use("/api/site_map", siteMapRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/feedback", require("./routes/feedbackRoutes"));
app.use("/api", adminRoutes);
app.use("/api", usernameRoutes);
app.use("/api/bento", trackActivity, bentoRoutes);
app.use("/api/block", trackActivity, blockRoutes);
app.use("/api/demo", require("./routes/demoRoutes"));

// Serve uploaded files statically
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Short link redirect for affiliate links
const { redirectAndTrack } = require("./controllers/linksController");
const { isProd } = require("./constants");
app.get("/r/:slug", redirectAndTrack);


app.get("/", (req, res) => {
  if (isProd) {
    res.redirect(process.env.FRONTEND_URL || "http://localhost:3005")

  } else {
    res.send(`Hushwork Now is live @ ${process.env.FRONTEND_URL || process.env.ALLOWED_ORIGINS[0]}`)
  }
});


function generateRandomUserId() {
  return new mongoose.Types.ObjectId();
}

// Error Handling middlewares
app.use(notFound);
app.use(errorHandler);

async function startServer() {
  await connectDB();
  require('./utils/slackService').init();

  const PORT = process.env.PORT;
  const server = app.listen(PORT, () => {
    console.log(`Server running on PORT ${PORT}...`.yellow.bold);
  });
  initializeSocket(server);

  const redis = getRedisInstance();
  if (redis) {
    redis.ping()
      .then(() => console.log('Redis ping successful'))
      .catch(() => console.warn('Redis ping failed, continuing without Redis cache features.'));
  }

  const io = getIo();

  io.on("connection", (socket) => {
  let currentActiveChat = null
  console.log("Connected to socket.io");
  socket.on("setup", (userData) => {
    // Accept both string id (Better Auth) and legacy { _id } object
    const userId = typeof userData === "string" ? userData : userData?._id;
    if (userId) {
      socket.join(userId);
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
        await invalidateQuestionsListCache();

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
        answer: stripAllHtml(payload.answer?.trim() || ''),
        question_id: payload.question_id
      }

      try {
        let answerToAquestion = await questionAnswerModel.create(answerData);
        if (answerToAquestion) {
          if (!!answerToAquestion.answered_by) {
            await answerToAquestion.populate({
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
          await invalidateQuestionsListCache();

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

        // Notify question owner about the new reply
        questionModel.findById(payload.question_id).select("question_posted_by").lean()
          .then((q) => {
            if (q && payload.user_id) {
              notificationService.createAndEmit({
                actorId: payload.user_id,
                receiverId: q.question_posted_by,
                type: "REPLY",
                targetId: answer.data._id,
                targetType: "answer",
              });
            }
          })
          .catch(() => {});
      }
    }

  })

  socket.on("update_question_title", async (payload) => {
    let updatedQuestion = null
    try {
      updatedQuestion = await questionModel.findByIdAndUpdate(payload.question_id, { question: stripAllHtml(payload.question || '') }, { new: true })

      if (updatedQuestion) {
        // Update question cache with fresh data
        await updateQuestionCache(payload.question_id);
        await invalidateQuestionsListCache();

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

    // Broadcast title update to questions list
    if (updatedQuestion.status === 'Success') {
      io.to("questions_list").emit("question_title_updated", {
        question_id: payload.question_id,
        question: payload.question
      });
    }
  });


  socket.on("update_question_likes", async (payload) => {
    let updatedQuestion = null
    let question = null
    let isNewLike = false
    try {
      question = await questionModel.findById(payload.question_id);
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
      isNewLike = userIndex === -1;
      if (isNewLike) {
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
      await invalidateQuestionsListCache();

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

      // Notify question owner on new like (not on unlike)
      if (isNewLike && payload.user_id) {
        notificationService.createAndEmit({
          actorId: payload.user_id,
          receiverId: question.question_posted_by,
          type: "REACTION",
          targetId: question._id,
          targetType: "question",
        });
      }
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
        await invalidateQuestionsListCache();

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
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
