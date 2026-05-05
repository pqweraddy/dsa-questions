const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let questions = [];
let currentQuestionId = null;
let clients = [];
let nextId = 1;

function loadQuestionsFromFile() {
  const filePath = path.join(__dirname, 'questions.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const items = Array.isArray(data) ? data : (data.questions || []);
    questions = items.map((q, i) => ({
      id: i + 1,
      title: q.title || '',
      content: q.question || q.content || '',
      image: q.image || null,
      createdAt: new Date().toISOString(),
    }));
    nextId = questions.length + 1;
    console.log(`Loaded ${questions.length} question(s) from questions.json`);
  } catch (e) {
    console.warn('Could not load questions.json:', e.message);
  }
}

loadQuestionsFromFile();

function broadcast(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(client => client.res.write(payload));
}

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const client = { id: Date.now(), res };
  clients.push(client);

  const current = questions.find(q => q.id === currentQuestionId) || null;
  res.write(`data: ${JSON.stringify({ type: 'init', questions, currentQuestion: current })}\n\n`);

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    clients = clients.filter(c => c.id !== client.id);
  });
});

app.get('/api/questions', (req, res) => {
  res.json(questions);
});

app.get('/api/current', (req, res) => {
  const current = questions.find(q => q.id === currentQuestionId) || null;
  res.json(current);
});

app.post('/api/questions', (req, res) => {
  const { title, content, image } = req.body;
  if (!title && !content) return res.status(400).json({ error: 'Title or content required' });

  const question = {
    id: nextId++,
    title: title || '',
    content: content || '',
    image: image || null,
    createdAt: new Date().toISOString(),
  };

  questions.push(question);
  broadcast({ type: 'questions_updated', questions });
  res.status(201).json(question);
});

app.put('/api/questions/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const idx = questions.findIndex(q => q.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const { title, content, image } = req.body;
  questions[idx] = { ...questions[idx], title, content, image: image ?? questions[idx].image };
  broadcast({ type: 'questions_updated', questions });

  if (currentQuestionId === id) {
    broadcast({ type: 'question_selected', currentQuestion: questions[idx] });
  }

  res.json(questions[idx]);
});

app.post('/api/questions/:id/select', (req, res) => {
  const id = parseInt(req.params.id);
  const question = questions.find(q => q.id === id);
  if (!question) return res.status(404).json({ error: 'Not found' });

  currentQuestionId = id;
  broadcast({ type: 'question_selected', currentQuestion: question });
  res.json(question);
});

app.post('/api/clear', (req, res) => {
  currentQuestionId = null;
  broadcast({ type: 'question_selected', currentQuestion: null });
  res.json({ success: true });
});

app.post('/api/countdown', (req, res) => {
  broadcast({ type: 'countdown_start' });
  res.json({ success: true });
});

app.post('/api/reload', (req, res) => {
  currentQuestionId = null;
  loadQuestionsFromFile();
  broadcast({ type: 'questions_updated', questions });
  broadcast({ type: 'question_selected', currentQuestion: null });
  res.json({ success: true, count: questions.length });
});

app.delete('/api/questions/:id', (req, res) => {
  const id = parseInt(req.params.id);
  questions = questions.filter(q => q.id !== id);

  if (currentQuestionId === id) {
    currentQuestionId = null;
    broadcast({ type: 'question_selected', currentQuestion: null });
  }

  broadcast({ type: 'questions_updated', questions });
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`\nQuiz App running at http://localhost:${PORT}`);
  console.log(`  Player: http://localhost:${PORT}/player.html`);
  console.log(`  Host:   http://localhost:${PORT}/host.html\n`);
});
