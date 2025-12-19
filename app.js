/**
 * Основной модуль приложения для взаимодействия с UI
 */

// Элементы DOM
const salaryInput = document.getElementById('salaryInput');
const vacationInput = document.getElementById('vacationInput');
const vacationFile = document.getElementById('vacationFile');
const fileName = document.getElementById('fileName');
const calculateBtn = document.getElementById('calculateBtn');
const resetBtn = document.getElementById('resetBtn');
const formSection = document.getElementById('formSection');
const resultsSection = document.getElementById('resultsSection');
const errorSection = document.getElementById('errorSection');
const errorMessage = document.getElementById('errorMessage');
const loadingIndicator = document.getElementById('loadingIndicator');
const vacationGroup = document.getElementById('vacationGroup');

// Состояние приложения
let currentSalary = null;
let currentVacations = [];

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
});

/**
 * Настройка обработчиков событий
 */
function setupEventListeners() {
    salaryInput.addEventListener('input', handleSalaryInput);
    vacationInput.addEventListener('input', handleVacationInput);
    vacationFile.addEventListener('change', handleFileSelect);
    calculateBtn.addEventListener('click', handleCalculate);
    resetBtn.addEventListener('click', handleReset);
    
    // Обработка загрузки файла по клику на label
    document.querySelector('.file-label').addEventListener('click', (e) => {
        e.preventDefault();
        vacationFile.click();
    });
}

/**
 * Обработка ввода зарплаты
 */
function handleSalaryInput() {
    const salary = parseSalaryAmount(salaryInput.value);
    
    if (salary && salary > 0) {
        currentSalary = salary;
        vacationGroup.style.display = 'block';
        calculateBtn.disabled = false;
        hideError();
    } else {
        currentSalary = null;
        calculateBtn.disabled = true;
    }
}

/**
 * Обработка ввода отпусков
 */
function handleVacationInput() {
    if (vacationInput.value.trim()) {
        try {
            const vacations = parseVacationText(vacationInput.value);
            currentVacations = vacations || [];
            hideError();
        } catch (e) {
            // Ошибка парсинга - пока не показываем, пользователь может еще вводить
        }
    } else {
        currentVacations = [];
    }
}

/**
 * Обработка выбора файла
 */
async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Проверка размера файла (максимум 1 MB)
    const MAX_FILE_SIZE = 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
        showError('Файл слишком большой. Максимальный размер: 1 MB');
        vacationFile.value = '';
        fileName.textContent = '';
        return;
    }
    
    // Проверка расширения файла
    const allowedExtensions = ['.csv', '.txt', '.text'];
    const fileExt = '.' + file.name.split('.').pop().toLowerCase();
    
    if (!allowedExtensions.includes(fileExt)) {
        showError('Неподдерживаемый формат файла. Поддерживаются только: .csv, .txt');
        vacationFile.value = '';
        fileName.textContent = '';
        return;
    }
    
    fileName.textContent = `📎 ${file.name}`;
    
    try {
        const vacations = await parseVacationFile(file);
        if (vacations && vacations.length > 0) {
            currentVacations = vacations;
            // Заполняем текстовое поле для отображения
            vacationInput.value = vacations.map(v => {
                const start = formatDate(v.start_date);
                const end = formatDate(v.end_date);
                return start === end ? start : `${start}-${end}`;
            }).join('\n');
            hideError();
        } else {
            showError('В файле не найдено отпусков. Убедитесь, что файл содержит даты в правильном формате.');
        }
    } catch (e) {
        showError('Ошибка чтения файла: ' + e.message);
    }
}

/**
 * Обработка расчета зарплат
 */
async function handleCalculate() {
    if (!currentSalary || currentSalary <= 0) {
        showError('Введите корректную сумму зарплаты');
        return;
    }
    
    // Парсим отпуска из текстового поля, если файл не загружен
    if (vacationInput.value.trim() && currentVacations.length === 0) {
        try {
            const vacations = parseVacationText(vacationInput.value);
            currentVacations = vacations || [];
        } catch (e) {
            showError('Ошибка парсинга дат отпусков: ' + e.message);
            return;
        }
    }
    
    // Показываем индикатор загрузки
    showLoading();
    hideError();
    
    try {
        // Рассчитываем зарплаты
        const salaries = await calculateNextSalaries(
            currentSalary,
            SALARY_PAYMENT_DAYS,
            5,
            currentVacations
        );
        
        if (!salaries || salaries.length === 0) {
            showError('Не удалось рассчитать график зарплат. Попробуйте позже.');
            hideLoading();
            return;
        }
        
        // Показываем результаты
        displayResults(salaries);
        
        // Рассчитываем стоимость часа для текущего месяца
        await calculateHourlyRate();
        
    } catch (e) {
        showError('Ошибка расчета зарплат: ' + e.message);
        console.error(e);
    } finally {
        hideLoading();
    }
}

/**
 * Отображение результатов
 */
function displayResults(salaries) {
    // Обновляем summary
    document.getElementById('summarySalary').textContent = `${formatNumber(currentSalary)} ₽/месяц`;
    document.getElementById('summaryPaymentDays').textContent = `${SALARY_PAYMENT_DAYS.join(' и ')} числа каждого месяца`;
    
    if (currentVacations.length > 0) {
        document.getElementById('summaryVacations').style.display = 'flex';
        document.getElementById('summaryVacationsCount').textContent = currentVacations.length;
    } else {
        document.getElementById('summaryVacations').style.display = 'none';
    }
    
    // Отображаем список зарплат
    const salariesList = document.getElementById('salariesList');
    salariesList.innerHTML = '';
    
    const monthsRu = {
        1: 'января', 2: 'февраля', 3: 'марта', 4: 'апреля',
        5: 'мая', 6: 'июня', 7: 'июля', 8: 'августа',
        9: 'сентября', 10: 'октября', 11: 'ноября', 12: 'декабря'
    };
    
    salaries.forEach((salaryData, index) => {
        const date = salaryData.date;
        const amount = salaryData.amount;
        const workedDays = salaryData.worked_days;
        const periodStart = salaryData.period_start;
        const periodEnd = salaryData.period_end;
        const vacationDaysDeducted = salaryData.vacation_days_deducted || 0;
        
        const monthName = monthsRu[date.getMonth() + 1] || '';
        const startMonthName = monthsRu[periodStart.getMonth() + 1] || '';
        const endMonthName = monthsRu[periodEnd.getMonth() + 1] || '';
        
        const salaryItem = document.createElement('div');
        salaryItem.className = 'salary-item';
        
        let workedDaysText = `${workedDays} рабочих дней`;
        if (vacationDaysDeducted > 0) {
            workedDaysText += ` (-${vacationDaysDeducted} рабочих дней - отпуск)`;
        }
        
        salaryItem.innerHTML = `
            <div class="salary-item-header">
                <div class="salary-date">${date.getDate()} ${monthName}</div>
                <div class="salary-amount">${formatNumber(amount)} ₽</div>
            </div>
            <div class="salary-details">
                <div class="salary-detail">
                    <span class="label">За период:</span>
                    <span class="value">${periodStart.getDate()} ${startMonthName} - ${periodEnd.getDate()} ${endMonthName}</span>
                </div>
                <div class="salary-detail">
                    <span class="label">Отработано:</span>
                    <span class="value">${workedDaysText}</span>
                </div>
            </div>
        `;
        
        salariesList.appendChild(salaryItem);
    });
    
    // Показываем секцию результатов
    formSection.style.display = 'none';
    resultsSection.style.display = 'block';
    resetBtn.style.display = 'block';
}

/**
 * Расчет стоимости часа для текущего месяца
 */
async function calculateHourlyRate() {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const currentMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        
        // Загружаем рабочие дни текущего месяца
        await loadWorkingDaysBatch(currentMonthStart, currentMonthEnd);
        
        // Считаем количество рабочих дней в текущем месяце
        const workingDaysInCurrentMonth = await countWorkingDays(currentMonthStart, currentMonthEnd, null);
        
        if (workingDaysInCurrentMonth > 0) {
            const hourlyRate = (currentSalary / workingDaysInCurrentMonth) / 8;
            const overtimeRate = hourlyRate * 1.5;
            
            document.getElementById('hourlyRate').textContent = formatNumber(hourlyRate, 2) + ' ₽';
            document.getElementById('overtimeRate').textContent = formatNumber(overtimeRate, 2) + ' ₽';
            document.getElementById('hourlyRateSection').style.display = 'block';
        }
    } catch (e) {
        console.error('Ошибка расчета стоимости часа', e);
        document.getElementById('hourlyRateSection').style.display = 'none';
    }
}

/**
 * Обработка сброса
 */
function handleReset() {
    currentSalary = null;
    currentVacations = [];
    salaryInput.value = '';
    vacationInput.value = '';
    vacationFile.value = '';
    fileName.textContent = '';
    vacationGroup.style.display = 'none';
    calculateBtn.disabled = true;
    formSection.style.display = 'block';
    resultsSection.style.display = 'none';
    resetBtn.style.display = 'none';
    hideError();
    hideLoading();
    
    // Прокрутка наверх
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Парсинг суммы зарплаты с множителями
 */
function parseSalaryAmount(text) {
    if (!text) return null;
    
    const textLower = text.toLowerCase().trim();
    let multiplier = 1;
    let processedText = textLower;
    
    // Сначала проверяем миллионы (кк), потом тысячи (к)
    // Важно: проверяем "кк" ПЕРЕД "к", чтобы не спутать
    
    // Миллионы - проверяем "кк" (две буквы к подряд)
    if (textLower.includes('кк')) {
        multiplier = 1000000;
        // Удаляем "кк" из текста
        processedText = processedText.replace(/кк/g, '');
    } else if (textLower.includes('млн') || textLower.includes('миллион')) {
        multiplier = 1000000;
        processedText = processedText.replace(/(?:млн\.?|миллион[а-я]*)/g, '');
    } else if (textLower.match(/\d+\s*m\s*$/)) {
        multiplier = 1000000;
        processedText = processedText.replace(/m\s*$/g, '');
    }
    // Тысячи - проверяем "к" (но только если нет "кк")
    else if (textLower.includes('к') && !textLower.includes('кк')) {
        multiplier = 1000;
        // Удаляем "к" из текста
        processedText = processedText.replace(/к/g, '');
    } else if (textLower.match(/\d+\s*k\s*$/)) {
        multiplier = 1000;
        processedText = processedText.replace(/k\s*$/g, '');
    } else if (textLower.includes('тыс') || textLower.includes('тысяч')) {
        multiplier = 1000;
        processedText = processedText.replace(/(?:тыс\.?|тысяч[а-я]*)/g, '');
    }
    
    // Извлечение числа
    const numberMatch = processedText.match(/([\d\s]+(?:[.,]\d+)?)/);
    if (!numberMatch) {
        return null;
    }
    
    const amountStr = numberMatch[1].replace(/\s/g, '').replace(',', '.');
    
    try {
        const amount = parseFloat(amountStr);
        const result = Math.round(amount * multiplier);
        
        // Валидация: максимальная зарплата 5 миллионов
        const MAX_SALARY = 5000000;
        if (result > MAX_SALARY || result <= 0) {
            return null;
        }
        
        return result;
    } catch (e) {
        return null;
    }
}

/**
 * Форматирование числа с разделителями
 */
function formatNumber(num, decimals = 0) {
    return num.toLocaleString('ru-RU', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

/**
 * Форматирование даты
 */
function formatDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
}

/**
 * Показать ошибку
 */
function showError(message) {
    errorMessage.textContent = message;
    errorSection.style.display = 'block';
    resultsSection.style.display = 'none';
    
    // Прокрутка к ошибке
    errorSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Скрыть ошибку
 */
function hideError() {
    errorSection.style.display = 'none';
}

/**
 * Показать индикатор загрузки
 */
function showLoading() {
    loadingIndicator.style.display = 'block';
    calculateBtn.disabled = true;
}

/**
 * Скрыть индикатор загрузки
 */
function hideLoading() {
    loadingIndicator.style.display = 'none';
    calculateBtn.disabled = false;
}

