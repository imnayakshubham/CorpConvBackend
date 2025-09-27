require("colors");
const express = require("express");
const cookieParser = require("cookie-parser");


const connectDB = require("./config/db");
const dotenv = require("dotenv");
const userRoutes = require("./routes/userRoutes");
const chatRoutes = require("./routes/chatRoutes");
const jobRoutes = require("./routes/jobRoutes");
const messageRoutes = require("./routes/messageRoutes");

const postRoutes = require("./routes/postRoutes");
const commentRoutes = require("./routes/commentRoutes");

const questionRoutes = require("./routes/questionRoutes");
const surveyRoutes = require("./routes/surveyRoutes");
const siteMapRoutes = require("./routes/siteMapRoutes");
const aiRoutes = require('./routes/ai');


const cors = require("cors");

const { notFound, errorHandler } = require("./middleware/errorMiddleware");
const path = require("path");
const { initializeSocket, getIo } = require("./utils/socketManger");
const questionModel = require("./models/questionModel");
const questionAnswerModel = require("./models/questionAnswerModel");
const { default: mongoose } = require("mongoose");
const { job } = require("./restartServerCron");
const getRedisInstance = require("./redisClient/redisClient");
const { responseFormatter } = require("./middleware/responseFormatter");
const { markOnline, markOffline, syncOnlineStatusToDB } = require("./redisClient/redisUtils.js");
const logger = require("./utils/logger.js");

dotenv.config();
connectDB();
const app = express();
app.use(cookieParser());


app.set('trust proxy', 1);

const APP_ENV = process.env.APP_ENV

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
app.use(responseFormatter);

app.use(express.urlencoded({ extended: true }));
if (APP_ENV !== "PROD") {
  const swaggerUi = require('swagger-ui-express');

  const swaggerAutogen = require('swagger-autogen')()

  const outputFile = './swagger_output.json'
  const endpointsFiles = ["index.js"]

  swaggerAutogen(outputFile, endpointsFiles, {})
  const swaggerFile = require(outputFile)

  const swaggerOptions = {
    swaggerOptions: {
      docExpansion: 'none',          // Collapse endpoints by default
      deepLinking: true,             // Enable deep linking to sections
      displayRequestDuration: true,  // Show request duration
      defaultModelsExpandDepth: -1,  // Hide schema models by default
      syntaxHighlight: {
        theme: 'agate'               // Syntax highlight theme similar to FastAPI
      }
    },
    customCss: `
    .swagger-ui .topbar { display: none }  /* Hide default Swagger topbar like FastAPI */
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  `
  }

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerFile, swaggerOptions));
}
require('./workers/recommendationWorker.js')




if (APP_ENV === "PROD") {
  job.start()
}


app.get("/api/init", (req, res) => {
  try {
    res.status(200).json({
      status: "Success",
      message: "Helllo"
    });
  } catch (error) {
    console.error("Error handling /init request:", error);
    res.status(500).json({
      status: "Failed",
      message: "Something went wrong. Please try again."
    });
  }
});




app.use("/api", userRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/message", messageRoutes);
app.use("/api/job", jobRoutes);
app.use("/api/post", postRoutes);
app.use("/api/comment", commentRoutes);
app.use("/api/question", questionRoutes);
app.use("/api/survey", surveyRoutes);
app.use("/api/site_map", siteMapRoutes);
app.use('/api/ai', aiRoutes);



if (APP_ENV === "PROD") {
  app.use(trackActivity);
}





app.get("/", (req, res) => {
  const targetUrl = allowedOrigins.find(origin => origin.startsWith('https://') || origin.includes('hushwork'));
  res.send(`
    <main style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 90vh; font-family: Arial, sans-serif;">
      <h1 style="color: #2c3e50;">Welcome to Hushwork</h1>
      <p style="color: #34495e; font-size: 1.2rem; text-align: center; margin-bottom: 20px;">
        Your platform for confidential surveys and discussions.
      </p>
      <a href=${targetUrl} target="_blank" rel="noopener noreferrer" style="padding: 10px 20px; background-color: #3498db; color: white; text-decoration: none; border-radius: 5px; font-size: 1rem; transition: background-color 0.3s;">
        Visit Hushwork
      </a>
    </main>
  `);
});


function generateRandomUserId() {
  return new mongoose.Types.ObjectId();
}

app.use(errorHandler);
app.use(notFound);

const PORT = process.env.PORT;
const server = app.listen(
  PORT,
  console.log(`Server running on PORT ${PORT}...`.yellow.bold)
);
initializeSocket(server);


const redis = getRedisInstance();
if (APP_ENV === "PROD") {

  (async () => {
    try {
      await redis.ping(); // Test connection
      console.log('Redis connection ready');
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
    }
  })();
}


setInterval(() => {
  syncOnlineStatusToDB().catch(logger.error);
}, 10 * 60 * 1000);

const io = getIo()

io.on("connection", async (socket) => {
  let currentActiveChat = null

  console.log("Connected to socket.io");
  socket.on("setup", async (user_id) => {
    if (user_id) {
      socket.join(user_id);
      socket.emit("connected");

      socket.user_id = user_id
      await markOnline(user_id)

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
      logger.error("error ==>", error)
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
        answer = {
          data: null,
          status: 'Failed',
          message: "Something Went Wrong"
        }
      }
      io.to(payload.question_id).emit('get_answer_for_question', answer);
    }

  })

  socket.on("update_question_title", async (payload) => {
    let updatedQuestion = null
    try {
      updatedQuestion = await questionModel.findByIdAndUpdate(payload.question_id, { question: payload.question }, { new: true })

      if (updatedQuestion) {
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
      logger.error("error ==>", error)

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
  })

  socket.on("remove-user", (id) => {
    socket.leave(id);
  });

  socket.off("setup", async () => {
    await markOffline(user_id)
    socket.leave(user_id);
  });
});
