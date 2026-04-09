const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

let waitingPlayer = null;
let roomCounter = 0;
const rooms = {}; // Lưu trữ dữ liệu các phòng để xử lý "Đấu lại"

io.on('connection', (socket) => {
    console.log('User kết nối:', socket.id);

    // XỬ LÝ GHÉP TRẬN
    socket.on('findMatch', (playerName) => {
        socket.playerName = playerName; // Lưu tên người chơi

        if (waitingPlayer && waitingPlayer !== socket) {
            roomCounter++;
            const roomId = 'room_' + roomCounter;
            
            socket.join(roomId);
            waitingPlayer.join(roomId);

            rooms[roomId] = { p1: waitingPlayer, p2: socket, rematchVotes: 0 };

            waitingPlayer.emit('matchFound', { role: 'p1', roomId: roomId, oppName: socket.playerName });
            socket.emit('matchFound', { role: 'p2', roomId: roomId, oppName: waitingPlayer.playerName });

            waitingPlayer = null;
        } else {
            waitingPlayer = socket;
            socket.emit('waiting', 'Đang tìm đối thủ...');
        }
    });

    // ĐỒNG BỘ CHUYỂN ĐỘNG VÀ ĐÁNH
    socket.on('playerAction', (data) => {
        socket.to(data.roomId).emit('updateOpponent', data.playerData);
    });

    // ĐỒNG BỘ MẤT MÁU
    socket.on('playerHit', (data) => {
        socket.to(data.roomId).emit('takeDamage', data.damage);
    });

    // ĐỒNG BỘ BẮN SÚNG (Dành riêng cho Thành)
    socket.on('shoot', (data) => {
        socket.to(data.roomId).emit('opponentShoot', data);
    });

    // YÊU CẦU ĐẤU LẠI
    socket.on('rematchRequest', (roomId) => {
        if (rooms[roomId]) {
            rooms[roomId].rematchVotes++;
            socket.to(roomId).emit('rematchOffer'); // Báo cho đối thủ biết có lời mời
            
            // Nếu cả 2 đều đồng ý
            if (rooms[roomId].rematchVotes === 2) {
                rooms[roomId].rematchVotes = 0; // Reset số phiếu
                io.to(roomId).emit('rematchStart'); // Lệnh bắt đầu lại game
            }
        }
    });

    socket.on('disconnect', () => {
        if (waitingPlayer === socket) waitingPlayer = null;
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server Game đang chạy tại port ${PORT}`);
});
