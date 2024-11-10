// rutas_web.js
const express = require('express');
const router = express.Router();
const moment = require('moment-timezone');
const TIMEZONE = 'America/Bogota';

function configurarRutasWeb(db) {
    // Ruta para mostrar el historial de bingos
    router.get('/historial', (req, res) => {
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
                return res.status(500).json({ 
                    success: false, 
                    error: err.message 
                });
            }

            const bingos = rows.map(row => {
                const momentoInicio = moment(row.empieza).tz(TIMEZONE);
                const numerosArray = row.numeros ? row.numeros.split(',').map(Number) : [];
                
                return {
                    id: row.id,
                    estado: row.estado,
                    sesion: row.session,
                    fecha: momentoInicio.format('YYYY-MM-DD'),
                    hora: momentoInicio.format('HH:mm'),
                    observadores: row.observadores,
                    numerosTotales: numerosArray.length,
                    ultimoNumero: numerosArray.length > 0 ? numerosArray[numerosArray.length - 1] : null,
                    numeros: numerosArray,
                    nombreEvento: `Bingo_${momentoInicio.format('YYYY-MM-DD_HH:mm')}`
                };
            });

            // Agrupar bingos por fecha
            const bingosPorFecha = bingos.reduce((acc, bingo) => {
                if (!acc[bingo.fecha]) {
                    acc[bingo.fecha] = [];
                }
                acc[bingo.fecha].push(bingo);
                return acc;
            }, {});

            res.json({
                success: true,
                horaConsulta: moment().tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss'),
                resumen: {
                    totalBingos: bingos.length,
                    bingosFinalizados: bingos.filter(b => b.numerosTotales === 75).length,
                    bingosFuturos: bingos.filter(b => b.estado === 'futuro').length,
                    totalObservadores: bingos.reduce((sum, b) => sum + b.observadores, 0)
                },
                // Convertir el objeto a un array ordenado por fecha
                historial: Object.entries(bingosPorFecha).map(([fecha, bingos]) => ({
                    fecha,
                    bingos: bingos.sort((a, b) => b.hora.localeCompare(a.hora))
                })).sort((a, b) => b.fecha.localeCompare(a.fecha))
            });
        });
    });

    // Ruta para ver detalle de un bingo específico
    router.get('/bingo/:id', (req, res) => {
        const bingoId = req.params.id;

        db.get(`
            SELECT 
                *,
                CASE 
                    WHEN datetime(empieza) > datetime('now') THEN 'futuro'
                    WHEN datetime(empieza) <= datetime('now') THEN 'pasado'
                END as estado
            FROM bingos 
            WHERE id = ?
        `, [bingoId], (err, row) => {
            if (err) {
                return res.status(500).json({ 
                    success: false, 
                    error: err.message 
                });
            }

            if (!row) {
                return res.status(404).json({
                    success: false,
                    mensaje: `No se encontró el bingo con ID ${bingoId}`
                });
            }

            const momentoInicio = moment(row.empieza).tz(TIMEZONE);
            const numerosArray = row.numeros ? row.numeros.split(',').map(Number) : [];

            res.json({
                success: true,
                bingo: {
                    id: row.id,
                    estado: row.estado,
                    sesion: row.session,
                    fecha: momentoInicio.format('YYYY-MM-DD'),
                    hora: momentoInicio.format('HH:mm'),
                    observadores: row.observadores,
                    numerosTotales: numerosArray.length,
                    numeros: numerosArray,
                    ultimoNumero: numerosArray.length > 0 ? numerosArray[numerosArray.length - 1] : null,
                    nombreEvento: `Bingo_${momentoInicio.format('YYYY-MM-DD_HH:mm')}`,
                    creado: moment(row.created_at).tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss')
                }
            });
        });
    });

    // Ruta para obtener estadísticas
    router.get('/estadisticas', (req, res) => {
        const queries = {
            totalBingos: 'SELECT COUNT(*) as total FROM bingos',
            bingosPorDia: `
                SELECT 
                    date(empieza) as fecha,
                    COUNT(*) as total,
                    SUM(observadores) as observadores
                FROM bingos 
                GROUP BY date(empieza)
                ORDER BY fecha DESC
                LIMIT 7
            `,
            numerosPopulares: `
                SELECT numeros
                FROM bingos
                WHERE numeros IS NOT NULL
                AND numeros != ''
                ORDER BY datetime(empieza) DESC
                LIMIT 10
            `
        };

        Promise.all([
            new Promise((resolve, reject) => {
                db.get(queries.totalBingos, [], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            }),
            new Promise((resolve, reject) => {
                db.all(queries.bingosPorDia, [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            }),
            new Promise((resolve, reject) => {
                db.all(queries.numerosPopulares, [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            })
        ]).then(([totalRow, bingosPorDia, numerosRecientes]) => {
            // Procesar números recientes para encontrar los más comunes
            const numerosConteo = {};
            numerosRecientes.forEach(row => {
                if (row.numeros) {
                    row.numeros.split(',').forEach(num => {
                        const numero = parseInt(num);
                        numerosConteo[numero] = (numerosConteo[numero] || 0) + 1;
                    });
                }
            });

            const numerosPopulares = Object.entries(numerosConteo)
                .map(([numero, cantidad]) => ({ numero: parseInt(numero), cantidad }))
                .sort((a, b) => b.cantidad - a.cantidad)
                .slice(0, 10);

            res.json({
                success: true,
                horaConsulta: moment().tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss'),
                estadisticas: {
                    total: totalRow.total,
                    ultimos7Dias: bingosPorDia.map(row => ({
                        fecha: moment(row.fecha).format('YYYY-MM-DD'),
                        total: row.total,
                        observadores: row.observadores
                    })),
                    numerosPopulares
                }
            });
        }).catch(error => {
            res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        });
    });

    return router;
}

module.exports = configurarRutasWeb;