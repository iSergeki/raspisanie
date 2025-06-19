require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const config = require('./config');

const app = express();

const port = process.env.PORT || 3000;

// Настройка шаблонизатора
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

// Функция для создания подключения к БД
async function getDbConnection() {
    return await mysql.createConnection(config.db);
}

// Преобразование даты в читаемый формат
function formatDay(day) {
    const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
    const date = new Date(day);
    const dayOfWeek = days[date.getDay()];
    return `${dayOfWeek}`;
}

// Функция форматирования времени
function formatTime(time) {
    if (!time) return '--:--';
    if (typeof time === 'string' && time.includes(':')) {
        return time.length >= 5 ? time.slice(0, 5) : time;
    }
    return time.toString();
}

app.get('/', async (req, res) => {
    try {
        const { group, teacher } = req.query;
        const connection = await getDbConnection();

        // Получаем уникальные группы и преподавателей
        const [groupRows] = await connection.execute(`
            SELECT DISTINCT student_group FROM Расписание 
            WHERE student_group IS NOT NULL AND student_group != ''
            ORDER BY student_group
        `);
        const [teacherRows] = await connection.execute(`
            SELECT DISTINCT teacher FROM Расписание 
            WHERE teacher IS NOT NULL AND teacher != ''
            ORDER BY teacher
        `);

        if (!group && !teacher) {
            await connection.end();
            return res.render('schedule', {
                schedule: null,
                distinctGroups: groupRows.map(r => r.student_group),
                distinctTeachers: teacherRows.map(r => r.teacher),
                selectedGroup: null,
                selectedTeacher: null,
                formatTime
            });
        }

        // Увеличиваем лимит для GROUP_CONCAT
        await connection.execute(`SET SESSION group_concat_max_len = 1000000;`);

        let query;
        if (teacher && !group) {
            // Запрос ТОЛЬКО для преподавателя (без группировки по подгруппам)
            query = `
                SELECT 
                    day AS 'День',
                    start_time AS 'Время_начала',
                    end_time AS 'Время_окончания',
                    discipline AS 'Дисциплина',
                    week AS 'Неделя',
                    student_group AS 'Группа',
                    teacher AS 'Преподаватель',
                    classroom AS 'Аудитория'
                FROM Расписание
                WHERE teacher LIKE '%${teacher.trim()}%'
                AND start_time != '17:05'
                ORDER BY day, start_time
            `;
        } else {
            // Оригинальный запрос (группа + преподаватель)
            query = `
                SELECT 
                    day AS 'День', 
                    start_time AS 'Время_начала', 
                    end_time AS 'Время_окончания', 
                    discipline AS 'Дисциплина', 
                    week AS 'Неделя',
                    subgroup AS 'Подгруппа', 
                    student_group AS 'Группа',
                    GROUP_CONCAT(DISTINCT teacher SEPARATOR ', ') AS Преподаватели, 
                    GROUP_CONCAT(DISTINCT classroom SEPARATOR ', ') AS Аудитории 
                FROM Расписание 
                WHERE student_group = '${group}'
                ${teacher ? ` AND teacher LIKE '%${teacher}%'` : ''}
                AND start_time != '17:05'
                GROUP BY day, start_time, end_time, discipline, week, subgroup, student_group
                ORDER BY day, start_time
            `;
        }

        const [rows] = await connection.execute(query);
        await connection.end();

        // Упрощенная обработка данных
        const scheduleByDay = {};
        rows.forEach(row => {
            const dayKey = formatDay(row.День);
            if (!scheduleByDay[dayKey]) {
                scheduleByDay[dayKey] = [];
            }

            scheduleByDay[dayKey].push({
                time: `${formatTime(row['Время_начала'])}-${formatTime(row['Время_окончания'])}`,
                discipline: row['Дисциплина'],
                teachers: row['Преподаватель'] || row['Преподаватели'], // В зависимости от запроса
                classrooms: row['Аудитория'] || row['Аудитории'],
                week: row['Неделя'],
                subgroup: row['Подгруппа'] || null,
                group: row['Группа']
            });
        });

        res.render('schedule', {
            schedule: Object.keys(scheduleByDay).length > 0 ? scheduleByDay : null,
            distinctGroups: groupRows.map(r => r.student_group),
            distinctTeachers: teacherRows.map(r => r.teacher),
            selectedGroup: group,
            selectedTeacher: teacher,
            
            formatTime
        });

    } catch (error) {
        console.error('Ошибка при получении расписания:', error);
        res.status(500).send('Ошибка сервера');
    }
});

// Запуск сервера
app.listen(config.port, () => {
    console.log(`Сервер запущен на http://localhost:${config.port}`);
});
