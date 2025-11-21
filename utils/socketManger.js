let io;

const allowed = process.env.ALLOW_ORIGIN
    ? process.env.ALLOW_ORIGIN.split(",").map(o => o.trim())
    : []

function initializeSocket(server) {
    io = require("socket.io")(server, {
        pingTimeout: 60000,
        cors: {
            origin: allowed,
            methods: ["GET", "POST"],
            credentials: true,
        },
    });

    io.on('connection', (socket) => {
        console.log('A user connected');

        // Handle disconnection
        socket.on('disconnect', () => {
            console.log('User disconnected');
            socket.leave(socket._id);
        });
    });
}

function getIo() {
    if (!io) {
        throw new Error('Socket.io has not been initialized');
    }
    return io;
}

module.exports = { initializeSocket, getIo };
