let io;

function initializeSocket(server) {
    io = require("socket.io")(server, {
        pingTimeout: 60000,
        cors: {
            origin: process.env.ALLOW_ORIGIN,
            methods: ["GET", "POST"],
            credentials: true,
        },
    });

    io.on('connection', (socket) => {
        console.log('A user connected');

        // Handle disconnection
        socket.on('disconnect', () => {
            console.log('User disconnected');
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
