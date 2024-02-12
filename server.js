const express = require("express");
const connectDB = require("./config/db");
const dotenv = require("dotenv");
const userRoutes = require("./routes/userRoutes");
const chatRoutes = require("./routes/chatRoutes");
const jobRoutes = require("./routes/jobRoutes");
const messageRoutes = require("./routes/messageRoutes");

const postRoutes = require("./routes/postRoutes");
const commentRoutes = require("./routes/commentRoutes");


const cors = require("cors");

const { notFound, errorHandler } = require("./middleware/errorMiddleware");
const path = require("path");
const { initializeSocket, getIo } = require("./utils/socketManger");

dotenv.config();
connectDB();
const app = express();

app.use(cors({
  origin: process.env.ALLOW_ORIGIN,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// app.get("/", (req, res) => {
//   res.send("API Running!");
// });

app.use("/api", userRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/message", messageRoutes);
app.use("/api/job", jobRoutes);
app.use("/api/post", postRoutes);
app.use("/api/comment", commentRoutes);


app.post("/api/link-preview", async (req, res) => {
  try {
    //Send object as response
    res.status(200).json({ preview });
  } catch (error) {
    console.log(error)
    res
      .status(500)
      .json(
        "Something went wrong, please check your internet connection and also the url you provided"
      );
  }
});


// Error Handling middlewares
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT;
const server = app.listen(
  PORT,
  console.log(`Server running on PORT ${PORT}...`.yellow.bold)
);
console.log({ server })
initializeSocket(server);

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

  socket.off("setup", () => {
    console.log("USER DISCONNECTED");
    socket.leave(userData._id);
  });
});
