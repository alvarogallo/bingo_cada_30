// Modificar rutas_web.js para servir HTML
const express = require('express');
const router = express.Router();
const moment = require('moment-timezone');
const TIMEZONE = 'America/Bogota';
const path = require('path');

function configurarRutasWeb(db) {
    // Servir archivos estáticos
    router.use(express.static('public'));

    // Ruta para la página web
    router.get('/', (req, res) => {
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
                return res.status(500).send('Error al cargar los datos');
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

            res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Historial de Bingos</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@heroicons/react@2.0.18/outline.min.css" rel="stylesheet">
</head>
<body class="bg-gray-100">
    <div class="min-h-screen">
        <!-- Encabezado -->
        <header class="bg-blue-600 shadow-lg">
            <div class="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
                <h1 class="text-3xl font-bold text-white">
                    Historial de Bingos
                </h1>
            </div>
        </header>

        <!-- Contenido principal -->
        <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
            <!-- Resumen -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 class="text-2xl font-semibold text-gray-800 mb-4">Resumen</h2>
                <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div class="bg-blue-50 p-4 rounded-lg">
                        <p class="text-sm text-blue-600 font-medium">Total Bingos</p>
                        <p class="text-2xl font-bold text-blue-800">${bingos.length}</p>
                    </div>
                    <div class="bg-green-50 p-4 rounded-lg">
                        <p class="text-sm text-green-600 font-medium">Bingos Futuros</p>
                        <p class="text-2xl font-bold text-green-800">${bingos.filter(b => b.estado === 'futuro').length}</p>
                    </div>
                    <div class="bg-purple-50 p-4 rounded-lg">
                        <p class="text-sm text-purple-600 font-medium">Total Observadores</p>
                        <p class="text-2xl font-bold text-purple-800">${bingos.reduce((sum, b) => sum + b.observadores, 0)}</p>
                    </div>
                    <div class="bg-yellow-50 p-4 rounded-lg">
                        <p class="text-sm text-yellow-600 font-medium">Bingos Completados</p>
                        <p class="text-2xl font-bold text-yellow-800">${bingos.filter(b => b.numerosTotales === 75).length}</p>
                    </div>
                </div>
            </div>

            <!-- Tabla de bingos -->
            <div class="bg-white shadow-md rounded-lg overflow-hidden">
                <div class="px-4 py-5 sm:px-6 bg-gray-50">
                    <h3 class="text-lg leading-6 font-medium text-gray-900">
                        Lista de Bingos
                    </h3>
                </div>
                <div class="overflow-x-auto">
                    <table class="min-w-full divide-y divide-gray-200">
                        <thead class="bg-gray-50">
                            <tr>
                                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    ID
                                </th>
                                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Fecha
                                </th>
                                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Hora
                                </th>
                                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Estado
                                </th>
                                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Observadores
                                </th>
                                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Números
                                </th>
                                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Último Número
                                </th>
                            </tr>
                        </thead>
                        <tbody class="bg-white divide-y divide-gray-200">
                            ${bingos.map(bingo => `
                                <tr class="hover:bg-gray-50">
                                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                        ${bingo.id}
                                    </td>
                                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        ${bingo.fecha}
                                    </td>
                                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        ${bingo.hora}
                                    </td>
                                    <td class="px-6 py-4 whitespace-nowrap">
                                        <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                                            ${bingo.estado === 'futuro' 
                                                ? 'bg-green-100 text-green-800' 
                                                : 'bg-gray-100 text-gray-800'}">
                                            ${bingo.sesion}
                                        </span>
                                    </td>
                                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        ${bingo.observadores}
                                    </td>
                                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        ${bingo.numerosTotales}/75
                                    </td>
                                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        ${bingo.ultimoNumero || '-'}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </main>
<div class="mt-8 bg-white shadow-md rounded-lg overflow-hidden">
    <div class="px-4 py-5 sm:px-6 bg-gray-50">
        <h3 class="text-lg leading-6 font-medium text-gray-900">
            Detalle de Números Jugados
        </h3>
    </div>

    <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
                <tr>
                    <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        ID Bingo
                    </th>
                    <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Fecha y Hora
                    </th>
                    <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Total Números
                    </th>
                    <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Números Jugados
                    </th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
                ${bingos.slice(offset, offset + perPage).map(bingo => `
                    <tr class="hover:bg-gray-50">
                        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            ${bingo.id}
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            ${bingo.fecha} ${bingo.hora}
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            ${bingo.numerosTotales}/75
                        </td>
                        <td class="px-6 py-4 text-sm text-gray-500">
                            <div class="flex flex-wrap gap-1 max-w-2xl">
                                ${bingo.numeros.map(num => `
                                    <span class="inline-flex items-center justify-center h-6 w-6 rounded bg-blue-100 text-blue-800 text-xs font-medium">
                                        ${num}
                                    </span>
                                `).join('')}
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>

    <!-- Paginación -->
    <div class="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
        <div class="flex-1 flex justify-between sm:hidden">
            ${currentPage > 1 ? `
                <a href="?page=${currentPage - 1}" 
                   class="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                    Anterior
                </a>
            ` : ''}
            ${currentPage < totalPages ? `
                <a href="?page=${currentPage + 1}" 
                   class="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                    Siguiente
                </a>
            ` : ''}
        </div>
        <div class="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
                <p class="text-sm text-gray-700">
                    Mostrando <span class="font-medium">${offset + 1}</span> a 
                    <span class="font-medium">${Math.min(offset + perPage, bingos.length)}</span> de 
                    <span class="font-medium">${bingos.length}</span> resultados
                </p>
            </div>
            <div>
                <nav class="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                    ${Array.from({ length: totalPages }, (_, i) => i + 1).map(page => `
                        <a href="?page=${page}" 
                           class="relative inline-flex items-center px-4 py-2 border border-gray-300 
                                ${currentPage === page 
                                    ? 'bg-blue-50 border-blue-500 text-blue-600 z-10' 
                                    : 'bg-white text-gray-500 hover:bg-gray-50'} 
                                text-sm font-medium">
                            ${page}
                        </a>
                    `).join('')}
                </nav>
            </div>
        </div>
    </div>
</div>
        <!-- Footer -->
        <footer class="bg-white shadow mt-8">
            <div class="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8">
                <p class="text-center text-sm text-gray-500">
                    Última actualización: ${moment().tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss')}
                </p>
            </div>
        </footer>
    </div>

    <script>
        // Función para actualizar la página cada minuto
        setInterval(() => {
            window.location.reload();
        }, 60000);
    </script>
</body>
</html>
            `);
        });
    });

    return router;
}

module.exports = configurarRutasWeb;