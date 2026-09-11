export function buildTestingEnvironment() {
  const self = { currentTime: 0, getCurrentTime: () => self.currentTime };
  return self;
}
