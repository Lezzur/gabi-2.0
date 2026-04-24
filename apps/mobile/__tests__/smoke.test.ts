describe('smoke', () => {
  it('jest is working', () => {
    expect(1 + 1).toBe(2)
  })

  it('NODE_ENV is test', () => {
    expect(process.env.NODE_ENV).toBe('test')
  })
})
