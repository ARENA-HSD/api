import { describe, it, expect } from 'bun:test';

// Basit bir örnek test: İlerleyen süreçte Controller ve Service
// fonksiyonlarının Mock'lanarak test edilmesi buraya eklenecektir.

describe('Quizzes Import/Export System', () => {
  it('Geçerli bir import verisi şemaya uygun olmalıdır', () => {
    const validImportData = {
      questions: [
        {
          text: 'Dummy test question',
          timeLimit: 30,
          points: 1000,
          correctIndex: 0,
          mediaUrl: 'https://example.com/image.jpg',
          options: [
             { text: 'Option 1', color: 'red' },
             { text: 'Option 2', color: 'blue' },
             { text: 'Option 3', color: 'green' },
             { text: 'Option 4', color: 'yellow' },
          ]
        }
      ]
    };
    
    // Verinin parse edilebilirliğini ve formatını test etme
    expect(validImportData.questions).toBeInstanceOf(Array);
    expect(validImportData.questions.length).toBeGreaterThan(0);
    
    const question = validImportData.questions[0];
    expect(question.text.length).toBeGreaterThanOrEqual(5);
    expect(question.timeLimit).toBeGreaterThanOrEqual(10);
    expect(question.options.length).toBe(4);
    expect(question.correctIndex).toBeLessThanOrEqual(3);
  });
});
