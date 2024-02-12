let io;

function initializeSocket(server) {
    io = require("socket.io")(server, {
        pingTimeout: 60000,
        cors: {
            origin: "http://localhost:3001",
            // credentials: true,
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
