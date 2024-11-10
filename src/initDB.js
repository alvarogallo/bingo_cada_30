const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Función para obtener las próximas 3 horas programadas
function obtenerProximasHoras() {
    const ahora = new Date();
    const horas = [];
    
    if (ahora.getMinutes() >= 30) {
        ahora.setHours(ahora.getHours() + 1);
        ahora.setMinutes(0);
    } else {
        ahora.setMinutes(30);
    }
    ahora.setSeconds(0);
    ahora.setMilliseconds(0);

    for (let i = 0; i < 3; i++) {
        const nuevaHora = new Date(ahora);
        if (i > 0) {
            if (ahora.getMinutes() === 30) {
                nuevaHora.setHours(ahora.getHours() + Math.floor(i / 2));
                nuevaHora.setMinutes(i % 2 === 0 ? 30 : 0);
            } else {
                nuevaHora.setMinutes(30 * i);
            }
        }
        horas.push(nuevaHora.toISOString());
    }

    return horas;
}

// Función para crear nuevo bingo
function crearNuevoBingo(db, horaInicio) {
    return new Promise((resolve, reject) => {
        db.run(`
            INSERT INTO bingos (session, empieza, numeros, termino, observadores)
            VALUES (?, ?, ?, ?, ?)
        `, ['PROGRAMADA', horaInicio, '', '', 1], 
        function(err) {
            if (err) {
                console.error('Error al crear nuevo bingo:', err);
                reject(err);
            } else {
                console.log(`Nuevo bingo creado (ID: ${this.lastID}) programado para: ${horaInicio}`);
                resolve(this.lastID);
            }
        });
    });
}

// Función principal de inicialización
function initializeDatabase() {
    return new Promise((resolve, reject) => {
        const dbPath = path.join(__dirname, 'database.sqlite');
        const db = new sqlite3.Database(dbPath, async (err) => {
            if (err) {
                console.error('Error al conectar con la base de datos:', err);
                reject(err);
                return;
            }
            console.log('Conexión exitosa con la base de datos SQLite');
        });

        db.run(`
            CREATE TABLE IF NOT EXISTS bingos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session TEXT,
                empieza TEXT,
                numeros TEXT,
                termino TEXT,
                observadores INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `, async (err) => {
            if (err) {
                console.error('Error al crear la tabla bingos:', err);
                reject(err);
                return;
            }
            console.log('Tabla bingos verificada/creada exitosamente');

            try {
                // Verificar si ya hay registros
                const count = await new Promise((resolve, reject) => {
                    db.get('SELECT COUNT(*) as count FROM bingos', [], (err, row) => {
                        if (err) reject(err);
                        else resolve(row.count);
                    });
                });

                // Solo crear registros si la tabla está vacía
                if (count === 0) {
                    const proximasHoras = obtenerProximasHoras();
                    for (const hora of proximasHoras) {
                        await crearNuevoBingo(db, hora);
                    }
                    console.log('Registros iniciales creados exitosamente');
                } else {
                    console.log('La base de datos ya contiene registros');
                }

                resolve(db);
            } catch (error) {
                console.error('Error durante la inicialización:', error);
                reject(error);
            }
        });
    });
}

module.exports = { initializeDatabase };