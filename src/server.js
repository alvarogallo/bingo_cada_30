const express = require('express');
const app = express();
const port = 3000;

app.get('/api/disparo', (req, res) => {
    const ahora = new Date();
    res.json({
        hora: ahora.toLocaleTimeString(),
        fecha: ahora.toLocaleDateString(),
        completa: ahora.toLocaleString()
    });
});

app.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
});