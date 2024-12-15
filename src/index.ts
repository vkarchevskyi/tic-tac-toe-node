import express from 'express'
import { createServer } from 'node:http'
import { Server } from 'socket.io'

const app = express()
const server = createServer(app)
const io = new Server(server, {
  cors: {
    origin: 'https://vkarchevskyi.github.io:443',
    methods: ['GET', 'POST'],
  },
})

type Sign = 'X' | 'O' | ''
type Board = Sign[][][]
type SmallBoard = Sign[][]

type CurrentBoardIndex = number | null
type Position = { smallBoard: number; row: number; cell: number }

type Player = { id: string; sign: Sign }
type Game = {
  players: Player[]
  board: Board
  currentPlayer: Sign
  currentBoard: CurrentBoardIndex
  gameOver: boolean
  winner: Sign | null
  isTie: boolean
}

let games = new Map<string, Game>()

function generateId(length: number): string {
  let result = ''
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const charactersLength = characters.length
  let counter = 0
  while (counter < length) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength))
    counter += 1
  }
  return result
}

io.on('connection', (socket) => {
  console.log('A user connected: ', socket.id)

  socket.on('create-room', () => {
    const roomCode = generateId(5)

    games.set(roomCode, {
      players: [],
      board: getDefaultBoard(),
      currentPlayer: 'X',
      currentBoard: null,
      gameOver: false,
      winner: null,
      isTie: false,
    })

    socket.join(roomCode)
    games.get(roomCode)?.players.push({ id: socket.id, sign: 'X' })
    socket.emit('room-created', roomCode)
  })

  socket.on('join-room', (data: { roomCode: string }) => {
    const game = games.get(data.roomCode)

    if (!game) {
      socket.emit('error', 'Room not found!')
      return
    }

    if (game.players.length >= 2) {
      socket.emit('error', 'Room is full!')
      return
    }

    game.players.push({ id: socket.id, sign: 'O' })
    socket.join(data.roomCode)

    const [playerX, playerO] = games.get(data.roomCode)?.players ?? []

    io.to(playerX.id).emit('start-game', {
      roomCode: data.roomCode,
      board: game.board,
      currentPlayer: game.currentPlayer,
      currentBoard: game.currentBoard,
      player: playerX.sign,
    })

    io.to(playerO.id).emit('start-game', {
      roomCode: data.roomCode,
      board: game.board,
      currentPlayer: game.currentPlayer,
      currentBoard: game.currentBoard,
      player: playerO.sign,
    })
  })

  socket.on('make-move', (data: { roomCode: string; position: Position }) => {
    const { roomCode, position } = data
    const game = games.get(roomCode)

    if (!game) {
      socket.emit('error', 'Room not found!')
      return
    }

    const currentPlayer = game.players.find((player) => player.id === socket.id)?.sign
    if (!currentPlayer) {
      socket.emit('error', 'Player not found!')
      return
    }
    if (currentPlayer !== game.currentPlayer) {
      socket.emit('error', 'Not your turn!')
      return
    }

    if (
      !isValidMove(
        position.smallBoard,
        position.row,
        position.cell,
        game.gameOver,
        game.board,
        game.currentBoard,
        game.currentPlayer,
        currentPlayer
      )
    ) {
      socket.emit('error', 'Invalid move!')
      return
    }

    game.board[position.smallBoard][position.row][position.cell] = currentPlayer
    const winBoard = getWinnerBoard(game.board)

    if (checkWin(winBoard, currentPlayer)) {
      game.winner = currentPlayer
    } else if (checkTie(winBoard)) {
      game.isTie = true
    } else {
      game.currentPlayer = currentPlayer === 'X' ? 'O' : 'X'
    }

    if (game.winner !== null || game.isTie) {
      game.gameOver = true
    } else {
      game.currentBoard = getNextBoardIndex(game.board, position.row, position.cell)
    }

    io.to(roomCode).emit('move-made', {
      roomCode,
      board: game.board,
      currentPlayer: game.currentPlayer,
      currentBoard: game.currentBoard,
      winner: game.winner,
      isTie: game.isTie,
      gameOver: game.gameOver,
    })
  })

  socket.on('restart-game', (data: {roomCode: string}) => {
    const game = games.get(data.roomCode)
    if (game && game.gameOver) {
      game.board = getDefaultBoard()
      game.currentPlayer = 'X'
      game.currentBoard = null
      game.gameOver = false
      game.winner = null
      game.isTie = false

      io.to(data.roomCode).emit('game-restarted', {
        roomCode: data.roomCode,
        board: game.board,
        currentPlayer: game.currentPlayer,
        currentBoard: game.currentBoard,
        gameOver: game.gameOver,
        winner: game.winner,
        isTie: game.isTie,
      })
    }
  })

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id)

    games.forEach((game, roomCode) => {
      const playerIndex = game.players.findIndex((player) => player.id === socket.id)

      if (playerIndex !== -1) {
        game.players.splice(playerIndex, 1)
        io.to(roomCode).emit('player-disconnected')
        games.delete(roomCode)
      }
    })
  })
})

server.listen(3000, () => {
  console.log('server running at http://localhost:3000')
})

const boardSize: number = 9
const boardRowQuantity: number = 3

const getEmptyCellIndexes = (board: SmallBoard): number[] => {
  const emptyCellIndexes: number[] = []

  board.forEach((row: Sign[], index: number): void => {
    emptyCellIndexes.push(
      ...row
        .map(
          (sign: Sign, rowIndex: number): CurrentBoardIndex =>
            sign === '' ? rowIndex + boardRowQuantity * index : null
        )
        .filter((index: CurrentBoardIndex) => index !== null)
    )
  })

  return emptyCellIndexes
}

const getEmptySmallBoard = (): SmallBoard => {
  return [
    ['', '', ''],
    ['', '', ''],
    ['', '', ''],
  ]
}

const getDefaultBoard = (): Sign[][][] => {
  const board: Board = []

  for (let i = 0; i < boardSize; i++) {
    const smallBoard: SmallBoard = getEmptySmallBoard()
    board.push(smallBoard)
  }

  return board
}

const getNextBoardIndex = (board: Board, row: number, col: number) => {
  const index = row * 3 + col

  if (
    checkSmallBoardWin(board[index], 'X') ||
    checkSmallBoardWin(board[index], 'O') ||
    getEmptyCellIndexes(board[index]).length === 0
  ) {
    return null
  }

  return index
}

const isValidMove = (
  smallBoardIndex: number,
  row: number,
  col: number,
  gameOver: boolean,
  board: Board,
  currentBoard: CurrentBoardIndex,
  currentPlayer: Sign,
  player: Sign
): boolean => {
  const freeCell = board[smallBoardIndex][row][col] === ''
  const validBoardIndex = currentBoard === null || smallBoardIndex === currentBoard
  const validBoard = canMoveToSmallBoard(board[smallBoardIndex])
  const validPlayer = currentPlayer === player

  return freeCell && validBoardIndex && validBoard && validPlayer && !gameOver
}

const checkTie = (winnerBoard: SmallBoard): boolean => {
  for (let i = 0; i < boardRowQuantity; i++) {
    for (let j = 0; j < boardRowQuantity; j++) {
      if (winnerBoard[i][j] === '' && getEmptyCellIndexes(winnerBoard).includes(i * 3 + j)) {
        return false
      }
    }
  }
  return true
}

const getWinnerBoard = (board: Board): SmallBoard => {
  const winBoard: SmallBoard = getEmptySmallBoard()

  for (let i = 0; i < board.length; i++) {
    const x = i % 3
    const y = Math.floor(i / 3)

    if (checkSmallBoardWin(board[i], 'X')) {
      winBoard[y][x] = 'X'
    } else if (checkSmallBoardWin(board[i], 'O')) {
      winBoard[y][x] = 'O'
    }
  }

  return winBoard
}

const checkWin = (winBoard: SmallBoard, player: Sign): boolean => {
  for (let i = 0; i < boardRowQuantity; i++) {
    if (winBoard[i].every((cell): boolean => cell === player)) return true
    if (winBoard.every((row): boolean => row[i] === player)) return true
  }

  return (
    (winBoard[0][2] === player && winBoard[1][1] === player && winBoard[2][0] === player) ||
    (winBoard[0][0] === player && winBoard[1][1] === player && winBoard[2][2] === player)
  )
}

const checkSmallBoardWin = (board: SmallBoard, player: Sign): boolean => {
  for (let i = 0; i < boardRowQuantity; i++) {
    if (board[i].every((cell): boolean => cell === player)) return true
    if (board.every((row): boolean => row[i] === player)) return true
  }

  return (
    (board[0][2] === player && board[1][1] === player && board[2][0] === player) ||
    (board[0][0] === player && board[1][1] === player && board[2][2] === player)
  )
}

const canMoveToSmallBoard = (board: SmallBoard): boolean => {
  const emptyCells = board.reduce(
    (acc, row) => acc + row.reduce((acc, cell) => acc + Number(cell === ''), 0),
    0
  )

  return emptyCells > 0 && !checkSmallBoardWin(board, 'X') && !checkSmallBoardWin(board, 'O')
}
