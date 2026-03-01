allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}

/**
 * Generate release keystore if it doesn't exist yet.
 * Runs keytool from the current JVM (Gradle's embedded JDK).
 */
tasks.register("genKeystore") {
    val keystoreFile = file("superparty-release.keystore")
    doLast {
        if (!keystoreFile.exists()) {
            val keytool = "${System.getProperty("java.home")}/bin/keytool"
            exec {
                commandLine(
                    keytool,
                    "-genkey", "-v",
                    "-keystore", keystoreFile.absolutePath,
                    "-alias", "superparty",
                    "-keyalg", "RSA",
                    "-keysize", "2048",
                    "-validity", "10000",
                    "-dname", "CN=SuperParty, OU=Dev, O=SuperPartyAI, L=Romania, ST=Romania, C=RO",
                    "-storepass", "superparty2024!",
                    "-keypass", "superparty2024!"
                )
            }
            println("✅ Keystore generat: ${keystoreFile.absolutePath}")
        } else {
            println("ℹ️ Keystore există deja: ${keystoreFile.absolutePath}")
        }
    }
}
