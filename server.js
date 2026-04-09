const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

let waitingPlayer = null;
let roomCounter = 0;
const rooms = {};

io.on('connection', (socket) => {
    console.log('User kết nối:', socket.id);

    socket.on('findMatch', (playerName) => {
        socket.playerName = playerName;
        if (waitingPlayer && waitingPlayer !== socket) {
            roomCounter++;
            const roomId = 'room_' + roomCounter;
            socket.join(roomId); waitingPlayer.join(roomId);
            rooms[roomId] = { p1: waitingPlayer, p2: socket, rematchVotes: 0 };
            waitingPlayer.emit('matchFound', { role: 'p1', roomId: roomId, oppName: socket.playerName });
            socket.emit('matchFound', { role: 'p2', roomId: roomId, oppName: waitingPlayer.playerName });
            waitingPlayer = null;
        } else {
            waitingPlayer = socket;
            socket.emit('waiting', 'Đang tìm đối thủ...');
        }
    });

    socket.on('playerAction', (data) => socket.to(data.roomId).emit('updateOpponent', data.playerData));
    socket.on('playerHit', (data) => socket.to(data.roomId).emit('takeDamage', data.damage));
    
    // ĐỒNG BỘ VŨ KHÍ
    socket.on('shoot', (data) => socket.to(data.roomId).emit('opponentShoot', data));
    socket.on('throwBomb', (data) => socket.to(data.roomId).emit('opponentBomb', data));
    socket.on('shootGrenade', (data) => socket.to(data.roomId).emit('opponentGrenade', data));

    socket.on('rematchRequest', (roomId) => {
        if (rooms[roomId]) {
            rooms[roomId].rematchVotes++;
            socket.to(roomId).emit('rematchOffer');
            if (rooms[roomId].rematchVotes === 2) {
                rooms[roomId].rematchVotes = 0;
                io.to(roomId).emit('rematchStart');
            }
        }
    });

    socket.on('disconnect', () => { if (waitingPlayer === socket) waitingPlayer = null; });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server Game đang chạy tại port ${PORT}`));
