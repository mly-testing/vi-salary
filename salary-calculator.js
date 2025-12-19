/**
 * Модуль для расчета зарплат с учетом отпусков и производственного календаря РФ
 */

// Дни выплаты зарплаты по умолчанию
const SALARY_PAYMENT_DAYS = [14, 29];

// Глобальный кэш для рабочих дней (дата -> true/false)
const workingDaysCache = {};

/**
 * Форматирование даты в строку для кэша
 */
function dateToKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Создание объекта Date из строки ключа
 */
function keyToDate(key) {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day);
}

/**
 * Проверка, попадает ли дата в один из отпусков
 */
function isDateInVacation(date, vacations) {
    if (!vacations || vacations.length === 0) return false;
    
    const dateKey = dateToKey(date);
    
    for (const vacation of vacations) {
        const startKey = dateToKey(vacation.start_date);
        const endKey = dateToKey(vacation.end_date);
        
        if (dateKey >= startKey && dateKey <= endKey) {
            return true;
        }
    }
    
    return false;
}

/**
 * Загрузить информацию о рабочих днях для диапазона дат
 * Использует API isdayoff.ru
 */
async function loadWorkingDaysBatch(startDate, endDate) {
    const result = {};
    
    try {
        const current = new Date(startDate);
        current.setHours(0, 0, 0, 0);
        
        const end = new Date(endDate);
        end.setHours(0, 0, 0, 0);
        
        while (current <= end) {
            const year = current.getFullYear();
            const month = current.getMonth() + 1;
            const monthKey = `${year}-${String(month).padStart(2, '0')}`;
            
            // Проверяем, есть ли уже данные за этот месяц в кэше
            let monthHasData = false;
            for (const cachedKey in workingDaysCache) {
                const cachedDate = keyToDate(cachedKey);
                if (cachedDate.getFullYear() === year && cachedDate.getMonth() + 1 === month) {
                    monthHasData = true;
                    break;
                }
            }
            
            if (!monthHasData) {
                try {
                    const url = `https://isdayoff.ru/api/getdata?year=${year}&month=${month}`;
                    
                    const response = await fetch(url);
                    if (response.ok) {
                        const data = await response.text();
                        // API возвращает строку, где каждый символ - день месяца
                        // 0 - рабочий день, 1 - выходной
                        for (let day = 1; day <= data.length; day++) {
                            try {
                                const dayDate = new Date(year, month - 1, day);
                                const dayKey = dateToKey(dayDate);
                                const isWorking = data[day - 1] === '0';
                                workingDaysCache[dayKey] = isWorking;
                                result[dayKey] = isWorking;
                            } catch (e) {
                                // День не существует в этом месяце
                                continue;
                            }
                        }
                    }
                } catch (e) {
                    console.warn(`Ошибка загрузки данных за ${monthKey}`);
                }
            }
            
            // Переходим к следующему месяцу
            if (month === 12) {
                current.setFullYear(year + 1, 0, 1);
            } else {
                current.setMonth(month, 1);
            }
        }
    } catch (e) {
        console.error('Ошибка batch загрузки рабочих дней', e);
    }
    
    return result;
}

/**
 * Проверка является ли день рабочим в РФ
 * Учитывает отпуска - если день попадает в отпуск, он считается нерабочим
 */
async function isWorkingDay(date, vacations = null) {
    // Нормализуем дату (убираем время)
    const normalizedDate = new Date(date);
    normalizedDate.setHours(0, 0, 0, 0);
    
    // Если день попадает в отпуск - он нерабочий
    if (vacations && isDateInVacation(normalizedDate, vacations)) {
        return false;
    }
    
    const dateKey = dateToKey(normalizedDate);
    
    // Проверяем кэш
    if (dateKey in workingDaysCache) {
        return workingDaysCache[dateKey];
    }
    
    try {
        // Формат: YYYYMMDD
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dateStr = `${year}${month}${day}`;
        
        const url = `https://isdayoff.ru/${dateStr}`;
        const response = await fetch(url);
        
        if (response.ok) {
            const result = await response.text();
            // 0 - рабочий день, 1 - выходной
            const isWorking = result.trim() === '0';
            workingDaysCache[dateKey] = isWorking;
            return isWorking;
        } else {
            // Fallback на простую проверку
            const isWorking = date.getDay() !== 0 && date.getDay() !== 6;
            workingDaysCache[dateKey] = isWorking;
            return isWorking;
        }
    } catch (e) {
        // Fallback - простая проверка выходных
        const isWorking = date.getDay() !== 0 && date.getDay() !== 6;
        workingDaysCache[dateKey] = isWorking;
        return isWorking;
    }
}

/**
 * Получить предыдущий рабочий день
 */
async function getPreviousWorkingDay(date, vacations = null) {
    const current = new Date(date);
    current.setHours(0, 0, 0, 0);
    current.setDate(current.getDate() - 1);
    
    while (!(await isWorkingDay(current, vacations))) {
        current.setDate(current.getDate() - 1);
    }
    
    return current;
}

/**
 * Получить последний рабочий день месяца
 */
async function getLastWorkingDayOfMonth(year, month, vacations = null) {
    // Определяем последний день месяца
    const lastDay = new Date(year, month, 0).getDate();
    
    // Ищем последний рабочий день, идя назад от последнего дня месяца
    let current = new Date(year, month - 1, lastDay);
    current.setHours(0, 0, 0, 0);
    
    while (!(await isWorkingDay(current, vacations))) {
        current.setDate(current.getDate() - 1);
    }
    
    return current;
}

/**
 * Подсчет рабочих дней между датами (включительно)
 * Учитывает отпуска - дни в отпуске не считаются рабочими
 */
async function countWorkingDays(startDate, endDate, vacations = null) {
    let count = 0;
    const current = new Date(startDate);
    current.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);
    
    while (current <= end) {
        if (await isWorkingDay(new Date(current), vacations)) {
            count++;
        }
        current.setDate(current.getDate() + 1);
    }
    
    return count;
}

/**
 * Рассчитать следующие зарплаты с учетом рабочих дней и отпусков
 */
async function calculateNextSalaries(monthlySalary, paymentDays = null, count = 5, vacations = null) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const salaries = [];
    paymentDays = paymentDays || SALARY_PAYMENT_DAYS;
    
    // Нормализуем отпуска
    const normalizedVacations = [];
    if (vacations) {
        for (const vac of vacations) {
            let startDate, endDate;
            
            if (typeof vac.start_date === 'string') {
                startDate = new Date(vac.start_date);
            } else {
                startDate = new Date(vac.start_date);
            }
            
            if (typeof vac.end_date === 'string') {
                endDate = new Date(vac.end_date);
            } else {
                endDate = new Date(vac.end_date);
            }
            
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(0, 0, 0, 0);
            
            normalizedVacations.push({
                start_date: startDate,
                end_date: endDate
            });
        }
    }
    
    vacations = normalizedVacations;
    
    // Получаем все месяцы для расчета (с запасом)
    const MONTHS_BUFFER_MULTIPLIER = 2;
    const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthsToCheck = [];
    
    for (let i = 0; i < count * MONTHS_BUFFER_MULTIPLIER; i++) {
        const month = new Date(currentMonth);
        month.setMonth(month.getMonth() + i);
        monthsToCheck.push(new Date(month.getFullYear(), month.getMonth(), 1));
    }
    
    // Убираем дубликаты
    const uniqueMonths = [];
    const seen = new Set();
    for (const month of monthsToCheck) {
        const key = `${month.getFullYear()}-${month.getMonth()}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueMonths.push(month);
        }
    }
    
    // ОПТИМИЗАЦИЯ: Загружаем все рабочие дни сразу одним batch-запросом
    if (uniqueMonths.length > 0) {
        // Нужно загрузить данные с предыдущего месяца (для расчета первой зарплаты)
        const firstMonth = uniqueMonths[0];
        const startLoadDate = new Date(firstMonth.getFullYear(), firstMonth.getMonth() - 1, 1);
        
        // До последнего месяца в списке
        const lastMonth = uniqueMonths[uniqueMonths.length - 1];
        const endLoadDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0);
        
        // Загружаем все данные о рабочих днях сразу
        await loadWorkingDaysBatch(startLoadDate, endLoadDate);
    }
    
    for (const month of uniqueMonths) {
        if (salaries.length >= count) {
            break;
        }
        
        const year = month.getFullYear();
        const monthNum = month.getMonth() + 1;
        
        // Определяем последний день месяца
        const lastDay = new Date(year, monthNum, 0).getDate();
        
        // Проверяем дни выплат
        let daysToCheck = [...paymentDays];
        if (monthNum === 12) {
            // В декабре заменяем 29 на 26
            if (daysToCheck.includes(29)) {
                daysToCheck = daysToCheck.filter(d => d !== 29);
                if (!daysToCheck.includes(26)) {
                    daysToCheck.push(26);
                }
            }
        }
        
        for (const paymentDay of daysToCheck) {
            if (salaries.length >= count) {
                break;
            }
            
            let paymentDate;
            
            // Если день выплаты больше, чем дней в месяце, используем последний рабочий день месяца
            if (lastDay < paymentDay) {
                paymentDate = await getLastWorkingDayOfMonth(year, monthNum, null);
            } else {
                const salaryDate = new Date(year, monthNum - 1, paymentDay);
                salaryDate.setHours(0, 0, 0, 0);
                
                // Если день выплаты - выходной/праздник, переносим на предыдущий рабочий день
                if (await isWorkingDay(salaryDate, null)) {
                    paymentDate = salaryDate;
                } else {
                    paymentDate = await getPreviousWorkingDay(salaryDate, null);
                }
            }
            
            // Пропускаем зарплаты, которые уже должны были прийти
            // Нормализуем даты для корректного сравнения
            paymentDate.setHours(0, 0, 0, 0);
            const todayNormalized = new Date(today);
            todayNormalized.setHours(0, 0, 0, 0);
            
            if (paymentDate <= todayNormalized) {
                continue;
            }
            
            // Определяем период оплаты в зависимости от дня выплаты
            let periodStart, periodEnd, workingDaysInPeriodMonth, dailyRate;
            
            // СПЕЦИАЛЬНАЯ ЛОГИКА ДЛЯ ДЕКАБРЯ
            if (monthNum === 12 && paymentDay === 26) {
                // 26 декабря - зарплата за период с 1 по 19 декабря
                periodStart = new Date(year, 11, 1);
                periodStart.setHours(0, 0, 0, 0);
                periodEnd = new Date(year, 11, 19);
                periodEnd.setHours(0, 0, 0, 0);
                
                // Рабочие дни считаем в декабре
                const firstDay = new Date(year, 11, 1);
                firstDay.setHours(0, 0, 0, 0);
                const lastDayDate = new Date(year, 11, 31);
                lastDayDate.setHours(0, 0, 0, 0);
                workingDaysInPeriodMonth = await countWorkingDays(firstDay, lastDayDate, null);
                dailyRate = workingDaysInPeriodMonth > 0 ? monthlySalary / workingDaysInPeriodMonth : 0;
            } else if (monthNum === 1 && paymentDay === 14) {
                // 14 января - зарплата за период с 20 по 31 декабря предыдущего года
                const prevYear = year - 1;
                periodStart = new Date(prevYear, 11, 20);
                periodStart.setHours(0, 0, 0, 0);
                periodEnd = new Date(prevYear, 11, 31);
                periodEnd.setHours(0, 0, 0, 0);
                
                // Рабочие дни считаем в декабре
                const firstDay = new Date(prevYear, 11, 1);
                firstDay.setHours(0, 0, 0, 0);
                const lastDayDate = new Date(prevYear, 11, 31);
                lastDayDate.setHours(0, 0, 0, 0);
                workingDaysInPeriodMonth = await countWorkingDays(firstDay, lastDayDate, null);
                dailyRate = workingDaysInPeriodMonth > 0 ? monthlySalary / workingDaysInPeriodMonth : 0;
            } else if (paymentDay === 14 && monthNum === 12) {
                // 14 декабря - стандартная выплата за период с 16 ноября по 30 ноября
                const prevYear = year;
                const prevMonthNum = 11;
                
                // Последний день ноября
                const prevMonthLast = new Date(year, 10, 30);
                prevMonthLast.setHours(0, 0, 0, 0);
                
                // Период: с 16 числа ноября
                periodStart = new Date(prevYear, 10, 16);
                periodStart.setHours(0, 0, 0, 0);
                periodEnd = prevMonthLast;
                
                // Рабочие дни считаем в ноябре
                const prevMonthFirst = new Date(prevYear, 10, 1);
                prevMonthFirst.setHours(0, 0, 0, 0);
                workingDaysInPeriodMonth = await countWorkingDays(prevMonthFirst, prevMonthLast, null);
                dailyRate = workingDaysInPeriodMonth > 0 ? monthlySalary / workingDaysInPeriodMonth : 0;
            } else if (paymentDay === 14 && monthNum !== 1) {
                // 14 числа (кроме января и декабря) - зарплата за период с 16 числа предыдущего месяца
                const prevMonthNum = monthNum - 1;
                const prevYear = year;
                
                // Последний день предыдущего месяца
                const prevMonthLast = new Date(year, monthNum - 1, 0);
                prevMonthLast.setHours(0, 0, 0, 0);
                
                // Период: с 16 числа предыдущего месяца
                periodStart = new Date(prevYear, prevMonthNum - 1, 16);
                periodStart.setHours(0, 0, 0, 0);
                periodEnd = prevMonthLast;
                
                // Рабочие дни считаем в предыдущем месяце
                const prevMonthFirst = new Date(prevYear, prevMonthNum - 1, 1);
                prevMonthFirst.setHours(0, 0, 0, 0);
                workingDaysInPeriodMonth = await countWorkingDays(prevMonthFirst, prevMonthLast, null);
                dailyRate = workingDaysInPeriodMonth > 0 ? monthlySalary / workingDaysInPeriodMonth : 0;
            } else {
                // 29 числа - зарплата за период с 1 по 15 число текущего месяца
                periodStart = new Date(year, monthNum - 1, 1);
                periodStart.setHours(0, 0, 0, 0);
                periodEnd = new Date(year, monthNum - 1, 15);
                periodEnd.setHours(0, 0, 0, 0);
                
                // Рабочие дни считаем в текущем месяце
                const firstDay = new Date(year, monthNum - 1, 1);
                firstDay.setHours(0, 0, 0, 0);
                const lastDayDate = new Date(year, monthNum - 1, lastDay);
                lastDayDate.setHours(0, 0, 0, 0);
                workingDaysInPeriodMonth = await countWorkingDays(firstDay, lastDayDate, null);
                dailyRate = workingDaysInPeriodMonth > 0 ? monthlySalary / workingDaysInPeriodMonth : 0;
            }
            
            // Рабочие дни с учетом отпусков (фактически отработанные)
            const workedDays = await countWorkingDays(periodStart, periodEnd, vacations);
            // Рабочие дни без отпусков (для вычета)
            const workedDaysWithoutVacations = await countWorkingDays(periodStart, periodEnd, null);
            const vacationDaysDeducted = workedDaysWithoutVacations - workedDays;
            const amount = Math.round(dailyRate * workedDays);
            
            // Защита от переполнения
            const MAX_SALARY_AMOUNT = 5000000;
            const finalAmount = amount > MAX_SALARY_AMOUNT ? MAX_SALARY_AMOUNT : amount;
            
            salaries.push({
                date: paymentDate,
                amount: finalAmount,
                worked_days: workedDays,
                total_days: workingDaysInPeriodMonth,
                period_start: periodStart,
                period_end: periodEnd,
                vacation_days_deducted: vacationDaysDeducted
            });
        }
    }
    
    return salaries.slice(0, count);
}

/**
 * Парсинг даты в различных форматах
 */
function parseDate(dateStr) {
    dateStr = dateStr.trim();
    const currentYear = new Date().getFullYear();
    
    // Список форматов для попытки парсинга
    const formats = [
        { pattern: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, handler: (m) => new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])) },
        { pattern: /^(\d{1,2})\.(\d{1,2})$/, handler: (m) => new Date(currentYear, parseInt(m[2]) - 1, parseInt(m[1])) },
        { pattern: /^(\d{1,2})\s+(\d{1,2})$/, handler: (m) => new Date(currentYear, parseInt(m[2]) - 1, parseInt(m[1])) },
        { pattern: /^(\d{2})(\d{2})(\d{4})$/, handler: (m) => new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])) },
        { pattern: /^(\d{2})(\d{2})$/, handler: (m) => new Date(currentYear, parseInt(m[2]) - 1, parseInt(m[1])) }
    ];
    
    for (const format of formats) {
        const match = dateStr.match(format.pattern);
        if (match) {
            try {
                const date = format.handler(match);
                if (date && !isNaN(date.getTime())) {
                    return date;
                }
            } catch (e) {
                continue;
            }
        }
    }
    
    throw new Error(`Неверный формат даты: ${dateStr}`);
}

/**
 * Парсинг одной строки с датой/диапазоном отпуска
 */
function parseVacationLine(line) {
    line = line.trim();
    if (!line) {
        return null;
    }
    
    const MIN_YEAR = 2020;
    const MAX_YEAR = new Date().getFullYear() + 5;
    
    try {
        // Пробуем диапазон через дефис
        if (line.includes('-')) {
            const parts = line.split('-', 2);
            if (parts.length === 2) {
                let startDate = parseDate(parts[0].trim());
                let endDate = parseDate(parts[1].trim());
                
                // Валидация: startDate <= endDate
                if (startDate > endDate) {
                    [startDate, endDate] = [endDate, startDate];
                }
                
                // Валидация диапазона лет
                if (startDate.getFullYear() < MIN_YEAR || endDate.getFullYear() > MAX_YEAR) {
                    return null;
                }
                
                return { start_date: startDate, end_date: endDate };
            }
        }
        
        // Пробуем диапазон через пробел (две даты)
        const parts = line.split(/\s+/);
        if (parts.length === 2) {
            try {
                let startDate = parseDate(parts[0]);
                let endDate = parseDate(parts[1]);
                
                // Валидация: startDate <= endDate
                if (startDate > endDate) {
                    [startDate, endDate] = [endDate, startDate];
                }
                
                // Валидация диапазона лет
                if (startDate.getFullYear() < MIN_YEAR || endDate.getFullYear() > MAX_YEAR) {
                    return null;
                }
                
                return { start_date: startDate, end_date: endDate };
            } catch (e) {
                // Игнорируем ошибку
            }
        }
        
        // Одна дата
        const date = parseDate(line);
        
        // Валидация диапазона лет
        if (date.getFullYear() < MIN_YEAR || date.getFullYear() > MAX_YEAR) {
            return null;
        }
        
        return { start_date: date, end_date: date };
        
    } catch (e) {
        // Ошибка парсинга - пропускаем строку
        return null;
    }
}

/**
 * Парсинг файла с датами отпусков
 */
async function parseVacationFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            try {
                const content = e.target.result;
                const isCSV = file.name.toLowerCase().endsWith('.csv');
                
                let vacations = [];
                
                if (isCSV) {
                    // Парсим CSV файл
                    const lines = content.split('\n');
                    const MAX_VACATION_LINES = 1000;
                    
                    // Пропускаем заголовок, если есть
                    let startIndex = 0;
                    if (lines.length > 0) {
                        const firstLine = lines[0].toLowerCase();
                        if (firstLine.includes('дата') || firstLine.includes('date') || firstLine.includes('начало')) {
                            startIndex = 1;
                        }
                    }
                    
                    for (let i = startIndex; i < Math.min(lines.length, MAX_VACATION_LINES + startIndex); i++) {
                        const line = lines[i].trim();
                        if (!line) continue;
                        
                        // Парсим CSV строку
                        const cells = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
                        const startStr = cells[0];
                        
                        if (!startStr) continue;
                        
                        // Пропускаем заголовки
                        if (startStr.toLowerCase().match(/^(дата|date|начало|start)$/i)) {
                            continue;
                        }
                        
                        const endStr = cells[1] || '';
                        
                        if (endStr) {
                            // Диапазон
                            try {
                                const startDate = parseDate(startStr);
                                const endDate = parseDate(endStr);
                                vacations.push({
                                    start_date: startDate,
                                    end_date: endDate
                                });
                            } catch (e) {
                                // Пробуем как диапазон в одной строке
                                const vacation = parseVacationLine(`${startStr}-${endStr}`);
                                if (vacation) {
                                    vacations.push(vacation);
                                }
                            }
                        } else {
                            // Одна дата
                            try {
                                const date = parseDate(startStr);
                                vacations.push({
                                    start_date: date,
                                    end_date: date
                                });
                            } catch (e) {
                                // Пробуем как диапазон в одной строке
                                const vacation = parseVacationLine(startStr);
                                if (vacation) {
                                    vacations.push(vacation);
                                }
                            }
                        }
                    }
                } else {
                    // Парсим текстовый файл
                    const lines = content.split('\n');
                    
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed.startsWith('#')) {
                            continue;
                        }
                        
                        const vacation = parseVacationLine(trimmed);
                        if (vacation) {
                            vacations.push(vacation);
                        }
                    }
                }
                
                resolve(vacations.length > 0 ? vacations : null);
            } catch (e) {
                reject(e);
            }
        };
        
        reader.onerror = () => reject(new Error('Ошибка чтения файла'));
        reader.readAsText(file, 'UTF-8');
    });
}

/**
 * Парсинг текста с датами отпусков
 */
function parseVacationText(text) {
    const lines = text.trim().split('\n');
    const vacations = [];
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        
        const vacation = parseVacationLine(trimmed);
        if (vacation) {
            vacations.push(vacation);
        }
    }
    
    return vacations.length > 0 ? vacations : null;
}

