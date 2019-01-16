
export async function persistError(message: string, stack: string) {
  try {
    console.error(message, stack)
  } catch(error) {
    console.log(error)
    process.exit(1)
  }
}