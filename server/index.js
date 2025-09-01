const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const axios = require("axios");
const ACTIONS = require("./Actions");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

const userSocketMap = {};
const whiteboardDataMap = {};
const codeDataMap = {};

const getAllConnectedClients = (roomId) =>
  Array.from(io.sockets.adapter.rooms.get(roomId) || []).map((socketId) => ({
    socketId,
    username: userSocketMap[socketId],
  }));

io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
    if (!roomId) return;
    userSocketMap[socket.id] = username || "Anonymous";
    socket.join(roomId);

    if (!whiteboardDataMap[roomId]) whiteboardDataMap[roomId] = { strokes: [], undoStack: [] };
    if (!codeDataMap[roomId]) codeDataMap[roomId] = "";

    const clients = getAllConnectedClients(roomId);
    clients.forEach(({ socketId }) => {
      io.to(socketId).emit(ACTIONS.JOINED, {
        clients,
        username,
        socketId: socket.id,
      });
    });

    io.to(socket.id).emit(ACTIONS.WHITEBOARD_SYNC, {
      whiteboardData: whiteboardDataMap[roomId].strokes,
    });
    io.to(socket.id).emit(ACTIONS.CODE_CHANGE, {
      code: codeDataMap[roomId],
    });

    console.log(`👤 ${username} joined ${roomId}`);
  });

  socket.on(ACTIONS.WHITEBOARD_BEGIN, ({ roomId, point }) => {
    const room = whiteboardDataMap[roomId];
    if (!room) return;
    const stroke = { type: "stroke", points: [point] };
    room.strokes.push(stroke);
    room.undoStack = [];
    socket.in(roomId).emit(ACTIONS.WHITEBOARD_BEGIN, { point });
  });

  socket.on(ACTIONS.WHITEBOARD_DRAW, ({ roomId, point }) => {
    const room = whiteboardDataMap[roomId];
    if (!room) return;
    const currentStroke = room.strokes[room.strokes.length - 1];
    if (currentStroke) currentStroke.points.push(point);
    socket.in(roomId).emit(ACTIONS.WHITEBOARD_DRAW, { point });
  });

  socket.on(ACTIONS.WHITEBOARD_END, ({ roomId }) => {
    socket.in(roomId).emit(ACTIONS.WHITEBOARD_END);
  });

  socket.on(ACTIONS.WHITEBOARD_CLEAR, ({ roomId }) => {
    whiteboardDataMap[roomId] = { strokes: [], undoStack: [] };
    io.in(roomId).emit(ACTIONS.WHITEBOARD_CLEAR);
  });

  socket.on(ACTIONS.WHITEBOARD_UNDO, ({ roomId }) => {
    const room = whiteboardDataMap[roomId];
    if (!room || room.strokes.length === 0) return;
    const lastStroke = room.strokes.pop();
    room.undoStack.push(lastStroke);
    io.in(roomId).emit(ACTIONS.WHITEBOARD_SYNC, { whiteboardData: room.strokes });
  });

  socket.on(ACTIONS.WHITEBOARD_REDO, ({ roomId }) => {
    const room = whiteboardDataMap[roomId];
    if (!room || room.undoStack.length === 0) return;
    const restored = room.undoStack.pop();
    room.strokes.push(restored);
    io.in(roomId).emit(ACTIONS.WHITEBOARD_SYNC, { whiteboardData: room.strokes });
  });

  socket.on(ACTIONS.WHITEBOARD_REQUEST_SYNC, ({ roomId }) => {
    const room = whiteboardDataMap[roomId];
    if (!room) return;
    io.to(socket.id).emit(ACTIONS.WHITEBOARD_SYNC, { whiteboardData: room.strokes });
  });

  socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code }) => {
    codeDataMap[roomId] = code;
    socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code });
  });

  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms];
    rooms.forEach((roomId) => {
      socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
        socketId: socket.id,
        username: userSocketMap[socket.id],
      });
    });
    delete userSocketMap[socket.id];
  });
});

const languageConfig = {
  python3: { versionIndex: "3" },
  java: { versionIndex: "3" },
  cpp: { versionIndex: "4" },
  nodejs: { versionIndex: "3" },
  c: { versionIndex: "4" },
  ruby: { versionIndex: "3" },
  go: { versionIndex: "3" },
  scala: { versionIndex: "3" },
  bash: { versionIndex: "3" },
  sql: { versionIndex: "3" },
  pascal: { versionIndex: "2" },
  csharp: { versionIndex: "3" },
  php: { versionIndex: "3" },
  swift: { versionIndex: "3" },
  rust: { versionIndex: "3" },
  r: { versionIndex: "3" },
};

app.post("/compile", async (req, res) => {
  const { code, language } = req.body;
  try {
    const response = await axios.post("https://api.jdoodle.com/v1/execute", {
      script: code,
      language,
      versionIndex: languageConfig[language].versionIndex,
      clientId: process.env.jDoodle_clientId,
      clientSecret: process.env.jDoodle_clientSecret,
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Failed to compile code" });
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
