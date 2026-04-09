const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public')); 

let waitingPlayer = null; 
let roomCounter = 0;

io.on('connection', (socket) => {
    console.log('Một người dùng kết nối:', socket.id);

    socket.on('findMatch', () => {
        if (waitingPlayer && waitingPlayer !== socket) {
            roomCounter++;
            const roomId = 'room_' + roomCounter;
            
            socket.join(roomId);
            waitingPlayer.join(roomId);

            waitingPlayer.emit('matchFound', { role: 'p1', roomId: roomId });
            socket.emit('matchFound', { role: 'p2', roomId: roomId });

            waitingPlayer = null; 
        } else {
            waitingPlayer = socket;
            socket.emit('waiting', 'Đang tìm đối thủ...');
        }
    });

    socket.on('playerAction', (data) => {
        socket.to(data.roomId).emit('updateOpponent', data.playerData);
    });

    // NHẬN TÍN HIỆU ĐÁNH TRÚNG VÀ TRỪ MÁU ĐỐI THỦ
    socket.on('playerHit', (data) => {
        socket.to(data.roomId).emit('takeDamage', data.damage);
    });

    socket.on('disconnect', () => {
        if (waitingPlayer === socket) waitingPlayer = null;
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server Game đang chạy tại port ${PORT}`);
});
