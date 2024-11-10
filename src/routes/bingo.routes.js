// bingo.routes.js
const express = require('express');
const cron = require('node-cron');
const router = express.Router();
require('dotenv').config();


function configurarRutas(db) {
    const intervalosActivos = new Map();

    async function emitirEvento(numero, secuencia, fecha_bingo) {
        try {
            const numeroString = numero.toString();
            
            const mensaje = {
                numero: numeroString,
                sec: secuencia,
                timestamp: new Date().toISOString()
            };

            const data = {
                canal: process.env.SOCKET_CANAL,
                token: process.env.SOCKET_TOKEN,
                evento: `Bingo_${fecha_bingo}`,
                mensaje: mensaje
            };

            console.log(`Enviando a socket.io: ${JSON.stringify(data)}`);
            
            const response = await fetch(process.env.SOCKET_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(JSON.stringify(data))
                },
                body: JSON.stringify(data)
            });

            const httpCode = response.status;
            const responseData = await response.text();
            
            console.log('Status Code:', httpCode);
            console.log('Response:', responseData);
            
            return {
                httpCode,
                response: responseData
            };
        } catch (error) {
            console.error('Error al emitir evento:', error);
            throw error;
        }
    }

    function generarNuevoNumero(numerosActuales) {
        const numerosUsados = numerosActuales ? numerosActuales.split(',').map(Number) : [];
        let nuevoNumero;
        do {
            nuevoNumero = Math.floor(Math.random() * 75) + 1;
        } while (numerosUsados.includes(nuevoNumero));
        return nuevoNumero;
    }


    function iniciarGeneracionNumeros(bingoId) {
        if (intervalosActivos.has(bingoId)) {
            return;
        }

        const intervalo = setInterval(async () => {
            try {
                // Obtener información del bingo
                const bingo = await new Promise((resolve, reject) => {
                    db.get('SELECT numeros, empieza FROM bingos WHERE id = ?', [bingoId], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });

                // Generar nuevo número
                const nuevoNumero = generarNuevoNumero(bingo.numeros);
                const numerosActuales = bingo.numeros ? bingo.numeros.split(',').map(Number) : [];
                const secuencia = numerosActuales.length + 1;
                const numerosActualizados = bingo.numeros ? `${bingo.numeros},${nuevoNumero}` : `${nuevoNumero}`;

                // Actualizar en la base de datos
                await new Promise((resolve, reject) => {
                    db.run('UPDATE bingos SET numeros = ? WHERE id = ?', 
                        [numerosActualizados, bingoId], 
                        function(err) {
                            if (err) reject(err);
                            else resolve(this.changes);
                        }
                    );
                });

                // Emitir evento con el nuevo número
                const fechaBingo = new Date(bingo.empieza).toISOString().split('T')[0];
                await emitirEvento(nuevoNumero, secuencia, fechaBingo);

                console.log(`Bingo ${bingoId}: Nuevo número generado: ${nuevoNumero} (${secuencia}/75)`);

                // Verificar si completamos los 75 números
                if (secuencia >= 75) {
                    clearInterval(intervalosActivos.get(bingoId));
                    intervalosActivos.delete(bingoId);
                    
                    await new Promise((resolve, reject) => {
                        db.run('UPDATE bingos SET session = ? WHERE id = ?', 
                            ['FINISHED', bingoId], 
                            function(err) {
                                if (err) reject(err);
                                else resolve(this.changes);
                            }
                        );
                    });
                    
                    console.log(`Bingo ${bingoId} completado con todos los números generados`);
                }

            } catch (error) {
                console.error(`Error en generación de números para bingo ${bingoId}:`, error);
            }
        }, parseInt(process.env.INTERVALO) * 1000);

        intervalosActivos.set(bingoId, intervalo);
        console.log(`Iniciada generación de números para bingo ${bingoId}`);
    }



    async function actualizarBingoActual() {
        const ahora = new Date();
        const minutos = ahora.getMinutes();
        
        if (minutos !== 0 && minutos !== 30) {
            console.log('No es momento de actualizar ningún bingo');
            return;
        }

        console.log(`Verificando bingos a las ${ahora.toLocaleString()}`);

        try {
            const horaExacta = new Date(ahora);
            horaExacta.setSeconds(0);
            horaExacta.setMilliseconds(0);
            
            const bingoActual = await new Promise((resolve, reject) => {
                db.get(`
                    SELECT * FROM bingos 
                    WHERE session = 'PROGRAMADA'
                    AND datetime(empieza) = datetime(?)
                `, [horaExacta.toISOString()], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });

            if (bingoActual) {
                // Actualizar el estado a 'RUNNING'
                await new Promise((resolve, reject) => {
                    db.run(`
                        UPDATE bingos 
                        SET session = 'RUNNING' 
                        WHERE id = ?
                    `, [bingoActual.id], function(err) {
                        if (err) reject(err);
                        else resolve(this.changes);
                    });
                });

                console.log(`Bingo ${bingoActual.id} actualizado a RUNNING. Hora inicio: ${new Date(bingoActual.empieza).toLocaleString()}`);
                
                // Iniciar generación de números
                iniciarGeneracionNumeros(bingoActual.id);
            } else {
                console.log('No hay bingo programado para iniciar en este momento exacto');
            }
        } catch (error) {
            console.error('Error al actualizar estado del bingo:', error);
        }
    }

    // Programar la tarea para que se ejecute en el minuto 00 y 30 de cada hora
    cron.schedule('0,30 * * * *', () => {
        actualizarBingoActual();
    });

    // También ejecutamos la verificación al iniciar el servidor
    actualizarBingoActual();

    // Función para obtener las próximas 3 horas válidas desde ahora
    function obtenerProximasHoras(desde) {
        const horas = [];
        const horaInicio = new Date(desde);
        
        // Ajustar a la próxima media hora o hora en punto
        const minutos = horaInicio.getMinutes();
        const nuevaHora = new Date(horaInicio);
        
        if (minutos >= 30) {
            // Si pasó la media hora, la siguiente será a la hora en punto
            nuevaHora.setHours(horaInicio.getHours() + 1);
            nuevaHora.setMinutes(0);
        } else {
            // Si no llegó a la media hora, la siguiente será a la media hora
            nuevaHora.setMinutes(30);
        }
        nuevaHora.setSeconds(0);
        nuevaHora.setMilliseconds(0);

        // Solo agregar si es futuro
        if (nuevaHora > horaInicio) {
            horas.push(new Date(nuevaHora));
        }

        // Agregar las siguientes dos horas
        for (let i = 1; i < 3; i++) {
            const siguienteHora = new Date(nuevaHora);
            if (nuevaHora.getMinutes() === 0) {
                siguienteHora.setMinutes(30 * i);
            } else {
                siguienteHora.setHours(siguienteHora.getHours() + Math.floor((i + 1) / 2));
                siguienteHora.setMinutes(i % 2 === 0 ? 30 : 0);
            }
            horas.push(siguienteHora);
        }

        return horas;
    }

    // Función para crear nuevo bingo
    async function crearNuevoBingo(horaInicio) {
        return new Promise((resolve, reject) => {
            const horaISO = horaInicio instanceof Date ? horaInicio.toISOString() : horaInicio;
            db.run(`
                INSERT INTO bingos (session, empieza, numeros, termino, observadores)
                VALUES (?, ?, ?, ?, ?)
            `, ['PROGRAMADA', horaISO, '', '', 1],
            function(err) {
                if (err) {
                    console.error('Error al crear nuevo bingo:', err);
                    reject(err);
                } else {
                    console.log(`Nuevo bingo creado (ID: ${this.lastID}) programado para: ${new Date(horaISO).toLocaleString()}`);
                    resolve(this.lastID);
                }
            });
        });
    }

    // Ruta para disparo
    router.get('/disparo', async (req, res) => {
        const ahora = new Date();
        
        try {
            // Obtener bingos futuros existentes
            const bingosFuturos = await new Promise((resolve, reject) => {
                db.all(`
                    SELECT * FROM bingos 
                    WHERE session = 'PROGRAMADA' 
                    AND datetime(empieza) > datetime(?)
                    ORDER BY empieza ASC
                `, [ahora.toISOString()], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });

            // Si hay menos de 3 bingos futuros, calcular las próximas horas necesarias
            const horasRequeridas = obtenerProximasHoras(ahora);
            console.log('Horas requeridas:', horasRequeridas.map(h => h.toLocaleString()));

            // Crear los bingos que faltan
            const nuevosBingos = [];
            for (const hora of horasRequeridas) {
                const horaISO = hora.toISOString();
                const existeBingo = bingosFuturos.some(bingo => 
                    Math.abs(new Date(bingo.empieza).getTime() - hora.getTime()) < 1000 // tolerancia de 1 segundo
                );

                if (!existeBingo) {
                    const bingoId = await crearNuevoBingo(hora);
                    nuevosBingos.push({
                        id: bingoId,
                        inicio: hora.toLocaleString(),
                        observadores: 1
                    });
                }
            }

            // Si se crearon nuevos bingos, obtener la lista actualizada
            if (nuevosBingos.length > 0) {
                const todosLosBingos = await new Promise((resolve, reject) => {
                    db.all(`
                        SELECT * FROM bingos 
                        WHERE session = 'PROGRAMADA' 
                        AND datetime(empieza) > datetime(?)
                        ORDER BY empieza ASC
                    `, [ahora.toISOString()], (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    });
                });

                res.json({
                    success: true,
                    horaDisparo: ahora.toLocaleString(),
                    mensaje: 'Nuevos bingos creados para mantener horarios futuros',
                    bingosFuturos: todosLosBingos.map(b => ({
                        id: b.id,
                        inicio: new Date(b.empieza).toLocaleString(),
                        observadores: b.observadores
                    }))
                });
                return;
            }

            // Si no se crearon nuevos bingos, incrementar observadores del próximo
            const proximoBingo = bingosFuturos[0];
            await new Promise((resolve, reject) => {
                db.run(`
                    UPDATE bingos 
                    SET observadores = observadores + 1 
                    WHERE id = ?
                `, [proximoBingo.id], function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                });
            });

            // Obtener bingo actualizado
            const bingoActualizado = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM bingos WHERE id = ?', [proximoBingo.id], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });

            res.json({
                success: true,
                horaDisparo: ahora.toLocaleString(),
                mensaje: `Observador agregado al bingo ${proximoBingo.id}`,
                bingosFuturos: bingosFuturos.map(b => ({
                    id: b.id,
                    inicio: new Date(b.empieza).toLocaleString(),
                    observadores: b.id === proximoBingo.id ? bingoActualizado.observadores : b.observadores
                }))
            });

        } catch (error) {
            console.error('Error en /disparo:', error);
            res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        }
    });

    // Ruta para obtener todos los registros históricos
    router.get('/registros', (req, res) => {
        const query = `
            SELECT 
                id,
                session,
                empieza,
                termino,
                observadores,
                created_at,
                numeros,
                CASE 
                    WHEN datetime(empieza) > datetime('now') THEN 'futuro'
                    WHEN datetime(empieza) <= datetime('now') THEN 'pasado'
                END as estado
            FROM bingos 
            ORDER BY datetime(empieza) DESC
        `;
    
        db.all(query, [], (err, rows) => {
            if (err) {
                res.status(500).json({ 
                    success: false, 
                    error: err.message 
                });
                return;
            }
    
            const registros = rows.map(row => {
                // Convertir string de números a array de números
                const numerosArray = row.numeros ? row.numeros.split(',').map(Number) : [];
                
                return {
                    id: row.id,
                    estado: row.estado,
                    sesion: row.session,
                    inicio: new Date(row.empieza).toLocaleString(),
                    termino: row.termino ? new Date(row.termino).toLocaleString() : null,
                    observadores: row.observadores,
                    creado: new Date(row.created_at).toLocaleString(),
                    numeros: {
                        lista: numerosArray,
                        total: numerosArray.length,
                        ultimoNumero: numerosArray.length > 0 ? numerosArray[numerosArray.length - 1] : null
                    }
                };
            });
    
            res.json({
                success: true,
                total: registros.length,
                registros: registros,
                resumen: {
                    futuros: registros.filter(r => r.estado === 'futuro').length,
                    pasados: registros.filter(r => r.estado === 'pasado').length,
                    totalObservadores: registros.reduce((sum, r) => sum + r.observadores, 0),
                    bingosCompletados: registros.filter(r => r.numeros.total === 75).length
                }
            });
        });
    });

    // Ruta para obtener un registro específico
    router.get('/registro/:id', (req, res) => {
        const query = `
            SELECT *,
            CASE 
                WHEN datetime(empieza) > datetime('now') THEN 'futuro'
                WHEN datetime(empieza) <= datetime('now') THEN 'pasado'
            END as estado
            FROM bingos 
            WHERE id = ?
        `;

        db.get(query, [req.params.id], (err, row) => {
            if (err) {
                res.status(500).json({ 
                    success: false, 
                    error: err.message 
                });
                return;
            }
            
            if (!row) {
                res.status(404).json({ 
                    success: false, 
                    mensaje: 'Registro no encontrado' 
                });
                return;
            }

            res.json({
                success: true,
                registro: {
                    id: row.id,
                    estado: row.estado,
                    sesion: row.session,
                    inicio: new Date(row.empieza).toLocaleString(),
                    termino: row.termino ? new Date(row.termino).toLocaleString() : null,
                    observadores: row.observadores,
                    creado: new Date(row.created_at).toLocaleString()
                }
            });
        });
    });

    // Ruta para ver próximos bingos
    router.get('/proximos', (req, res) => {
        const ahora = new Date().toISOString();
        db.all(`
            SELECT * FROM bingos 
            WHERE datetime(empieza) > datetime(?) 
            AND session = 'PROGRAMADA'
            ORDER BY datetime(empieza) ASC
        `, [ahora], (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({
                success: true,
                total: rows.length,
                proximos: rows.map(row => ({
                    id: row.id,
                    inicio: new Date(row.empieza).toLocaleString(),
                    observadores: row.observadores
                }))
            });
        });
    });


    router.get('/actual', (req, res) => {
        const ahora = new Date().toISOString();
        db.get(`
            SELECT * FROM bingos 
            WHERE session = 'RUNNING'
            ORDER BY empieza DESC 
            LIMIT 1
        `, [], (err, row) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }

            if (!row) {
                res.json({
                    success: true,
                    mensaje: 'No hay ningún bingo en ejecución',
                    bingoActual: null
                });
                return;
            }

            const numerosGenerados = row.numeros ? row.numeros.split(',').map(Number) : [];

            res.json({
                success: true,
                bingoActual: {
                    id: row.id,
                    estado: row.session,
                    inicio: new Date(row.empieza).toLocaleString(),
                    observadores: row.observadores,
                    numerosGenerados: numerosGenerados,
                    totalNumeros: numerosGenerados.length
                }
            });
        });
    });

    return router;
}

module.exports = configurarRutas;