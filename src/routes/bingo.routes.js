// bingo.routes.js
const express = require('express');
const cron = require('node-cron');
const router = express.Router();
const moment = require('moment-timezone'); 
require('dotenv').config();


const TIMEZONE = 'America/Bogota';
moment.tz.setDefault(TIMEZONE);

// Función helper para obtener hora actual en Bogotá
function getHoraBogota() {
    return moment().tz(TIMEZONE);
}

// Función para formatear fecha en zona Bogotá
function formatearFecha(fecha) {
    return moment(fecha).tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss');
}


function configurarRutas(db) {
    const intervalosActivos = new Map();

    async function emitirEvento(numero, secuencia, fecha_bingo) {
        try {
            const numeroString = numero.toString();
            const horaBogota = moment().tz(TIMEZONE);
            
            // Usar la hora exacta del bingo
            const momentoBingo = moment(fecha_bingo).tz(TIMEZONE);
            const fechaFormateada = momentoBingo.format('YYYY-MM-DD');
            const horaFormateada = momentoBingo.format('HH:mm');
            
            console.log('Construyendo nombre de evento:');
            console.log('Fecha bingo:', fechaFormateada);
            console.log('Hora bingo:', horaFormateada);
    
            const nombreEvento = `Bingo_${fechaFormateada}_${horaFormateada}`;
            
            const mensaje = {
                numero: numeroString,
                sec: secuencia,
                timestamp: horaBogota.format('YYYY-MM-DD HH:mm:ss'),
                zonaHoraria: TIMEZONE,
                horaBingo: momentoBingo.format('YYYY-MM-DD HH:mm:ss')
            };
    
            const data = {
                canal: process.env.SOCKET_CANAL,
                token: process.env.SOCKET_TOKEN,
                evento: nombreEvento,
                mensaje: mensaje
            };
    
            console.log(`Enviando evento: ${nombreEvento}`);
            console.log('Data:', JSON.stringify(data, null, 2));
    
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
    
                // Obtener la hora exacta del bingo
                const horaBingo = moment(bingo.empieza).tz(TIMEZONE);
                console.log('Hora del bingo:', horaBingo.format('YYYY-MM-DD HH:mm'));
    
                // Emitir evento con la hora correcta del bingo
                await emitirEvento(nuevoNumero, secuencia, bingo.empieza);
    
                // ... resto del código
            } catch (error) {
                console.error(`Error en generación de números para bingo ${bingoId}:`, error);
            }
        }, parseInt(process.env.INTERVALO) * 1000);
    
        intervalosActivos.set(bingoId, intervalo);
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

    cron.schedule('0,30 * * * *', () => {
        const ahora = getHoraBogota();
        console.log('=====================================');
        console.log(`Ejecutando tarea programada:`);
        console.log(`Hora Bogotá: ${ahora.format('YYYY-MM-DD HH:mm:ss')}`);
        console.log('=====================================');
        
        actualizarBingoActual();
    }, {
        scheduled: true,
        timezone: TIMEZONE
    });
    


    // También ejecutamos la verificación al iniciar el servidor
    actualizarBingoActual();

// En bingo.routes.js

// Función para limpiar bingos antiguos
async function limpiarBingosAntiguos() {
    try {
        // Primero contar cuántos bingos hay
        const count = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as total FROM bingos', [], (err, row) => {
                if (err) reject(err);
                else resolve(row.total);
            });
        });

        console.log(`Total de bingos en la base de datos: ${count}`);

        // Si hay más de 200, eliminar los más antiguos
        if (count > 200) {
            const exceso = count - 200;
            console.log(`Eliminando ${exceso} bingos antiguos...`);

            await new Promise((resolve, reject) => {
                db.run(`
                    DELETE FROM bingos 
                    WHERE id IN (
                        SELECT id FROM bingos 
                        ORDER BY datetime(empieza) ASC 
                        LIMIT ?
                    )
                `, [exceso], function(err) {
                    if (err) reject(err);
                    else {
                        console.log(`Bingos eliminados: ${this.changes}`);
                        resolve(this.changes);
                    }
                });
            });
        }
    } catch (error) {
        console.error('Error al limpiar bingos antiguos:', error);
    }
}

function obtenerProximasHoras(desde) {
    const horas = [];
    const horaInicio = moment(desde).tz(TIMEZONE);
    
    // Ajustar a la próxima media hora o hora en punto
    if (horaInicio.minutes() >= 30) {
        horaInicio.add(1, 'hour').minutes(0);
    } else {
        horaInicio.minutes(30);
    }
    horaInicio.seconds(0).milliseconds(0);

    // Solo agregar si es futuro
    if (horaInicio.isAfter(moment())) {
        horas.push(horaInicio.format());
    }

    // Agregar las siguientes dos horas
    for (let i = 1; i < 3; i++) {
        const siguienteHora = moment(horaInicio).tz(TIMEZONE);
        if (horaInicio.minutes() === 0) {
            siguienteHora.minutes(30 * i);
        } else {
            siguienteHora.add(Math.floor((i + 1) / 2), 'hours');
            siguienteHora.minutes(i % 2 === 0 ? 30 : 0);
        }
        horas.push(siguienteHora.format());
    }

    return horas;
}
    // Función para obtener las próximas 3 horas válidas desde ahora


    // Función para crear nuevo bingo
    async function crearNuevoBingo(horaInicio) {
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


    router.get('/traer/:id', (req, res) => {
        const bingoId = req.params.id;
    
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
            WHERE id = ?
        `;
    
        db.get(query, [bingoId], (err, row) => {
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
                    mensaje: `No se encontró el bingo con ID ${bingoId}`
                });
                return;
            }
    
            // Convertir string de números a array
            const numerosArray = row.numeros ? row.numeros.split(',').map(Number) : [];
    
            res.json({
                success: true,
                bingo: {
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
                }
            });
        });
    });
    // Ruta para disparo
    router.get('/disparo', async (req, res) => {
        const ahora = moment().tz(TIMEZONE);
        
        try {
            // Obtener bingos futuros existentes
            const bingosFuturos = await new Promise((resolve, reject) => {
                db.all(`
                    SELECT * FROM bingos 
                    WHERE session = 'PROGRAMADA' 
                    AND datetime(empieza) > datetime(?)
                    ORDER BY empieza ASC
                `, [ahora.format()], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
    
            // Si hay menos de 3 bingos futuros, calcular las próximas horas necesarias
            const horasRequeridas = obtenerProximasHoras(ahora);
            console.log('Horas requeridas:', horasRequeridas.map(h => moment(h).format('YYYY-MM-DD HH:mm:ss')));
    
            // Crear los bingos que faltan
            const nuevosBingos = [];
            for (const hora of horasRequeridas) {
                const existeBingo = bingosFuturos.some(bingo => 
                    moment(bingo.empieza).isSame(moment(hora))
                );
    
                if (!existeBingo) {
                    const bingoId = await crearNuevoBingo(hora);
                    nuevosBingos.push({
                        id: bingoId,
                        inicio: moment(hora).format('YYYY-MM-DD HH:mm:ss'),
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
                    `, [ahora.format()], (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    });
                });
    
                res.json({
                    success: true,
                    horaDisparo: ahora.format('YYYY-MM-DD HH:mm:ss'),
                    mensaje: 'Nuevos bingos creados para mantener horarios futuros',
                    intervaloSegundos: parseInt(process.env.INTERVALO || '10'),
                    zonaHoraria: TIMEZONE,
                    bingosFuturos: todosLosBingos.map(b => ({
                        id: b.id,
                        inicio: moment(b.empieza).format('YYYY-MM-DD HH:mm:ss'),
                        observadores: b.observadores,
                        nombreEvento: `Bingo_${moment(b.empieza).format('YYYY-MM-DD_HH:mm')}`
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
                horaDisparo: ahora.format('YYYY-MM-DD HH:mm:ss'),
                mensaje: `Observador agregado al bingo ${proximoBingo.id}`,
                intervaloSegundos: parseInt(process.env.INTERVALO || '10'),
                zonaHoraria: TIMEZONE,
                bingosFuturos: bingosFuturos.map(b => ({
                    id: b.id,
                    inicio: moment(b.empieza).format('YYYY-MM-DD HH:mm:ss'),
                    observadores: b.id === proximoBingo.id ? bingoActualizado.observadores : b.observadores,
                    nombreEvento: `Bingo_${moment(b.empieza).format('YYYY-MM-DD_HH:mm')}`
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

// En bingo.routes.js

router.get('/test-socket', async (req, res) => {
    try {
        const testData = {
            canal: process.env.SOCKET_CANAL,
            token: process.env.SOCKET_TOKEN,
            evento: 'TestSocket',
            mensaje: {
                test: true,
                timestamp: moment().tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss')
            }
        };

        console.log('Enviando test a socket.io:', testData);

        const response = await fetch(process.env.SOCKET_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(JSON.stringify(testData))
            },
            body: JSON.stringify(testData)
        });

        const responseData = await response.text();

        res.json({
            success: true,
            status: response.status,
            response: responseData,
            environmentVars: {
                socketUrl: process.env.SOCKET_URL,
                socketCanal: process.env.SOCKET_CANAL,
                // No mostrar el token completo por seguridad
                socketToken: process.env.SOCKET_TOKEN ? '***' + process.env.SOCKET_TOKEN.slice(-4) : null
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
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
                const numerosArray = row.numeros ? row.numeros.split(',').map(Number) : [];
                
                return {
                    id: row.id,
                    estado: row.estado,
                    sesion: row.session,
                    inicio: formatearFecha(row.empieza),
                    termino: row.termino ? formatearFecha(row.termino) : null,
                    observadores: row.observadores,
                    creado: formatearFecha(row.created_at),
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
                horaConsulta: formatearFecha(new Date()),
                zonaHoraria: TIMEZONE,
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