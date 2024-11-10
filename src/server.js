const express = require('express');
const { initializeDatabase } = require('./initDB');
const configurarRutas = require('./routes/bingo.routes');
const configurarRutasWeb = require('./routes/rutas_web');

const app = express();
const port = 3000;

let db;

initializeDatabase()
    .then((database) => {
        db = database;
        
        // Configurar las rutas
        app.use('/api', configurarRutas(db));
        app.use('/web', configurarRutasWeb(db)); 

        // Iniciar el servidor
        app.listen(port, () => {
            console.log(`Servidor corriendo en http://localhost:${port}`);
        });
    })
    .catch(err => {
        console.error('Error al inicializar la aplicación:', err);
        process.exit(1);
    });

// Manejar el cierre de la aplicación
process.on('SIGINT', () => {
    if (db) {
        db.close((err) => {
            if (err) {
                console.error('Error al cerrar la base de datos:', err);
            } else {
                console.log('Conexión con la base de datos cerrada');
            }
            process.exit(err ? 1 : 0);
        });
    }
});